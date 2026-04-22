// SQLite-backed CoordinatorStore using Node's built-in `node:sqlite` (v22+).
// Opt-in via the --db CLI flag or DOZZZE_COORD_DB env var. Survives restarts;
// still single-writer (fine for MVP — the queue is not a hot path).

// Use createRequire to pull in `node:sqlite` at runtime. This avoids Vite's
// module graph (which strips the `node:` prefix for non-builtin modules and
// then tries to resolve the bare "sqlite" name as an npm package, failing).
import { createRequire } from 'node:module';
import { JobSchema, ResultSchema, type Job, type Result } from '@dozzze/sdk';
import type { AccrualRow, CoordinatorStore } from './queue.js';

const nodeRequire = createRequire(import.meta.url);
interface NodeSqlite {
  DatabaseSync: new (file: string) => {
    exec(sql: string): void;
    prepare(sql: string): {
      run(...args: unknown[]): void;
      get(...args: unknown[]): unknown;
      all(...args: unknown[]): unknown[];
    };
    close(): void;
  };
}
const { DatabaseSync } = nodeRequire('node:sqlite') as NodeSqlite;

const SCHEMA_VERSION = 2;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL UNIQUE,
  payload     TEXT NOT NULL,
  enqueued_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS results (
  job_id      TEXT PRIMARY KEY,
  payload     TEXT NOT NULL,
  recorded_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS accruals (
  wallet_address  TEXT PRIMARY KEY,
  accrued         INTEGER NOT NULL DEFAULT 0,
  paid            INTEGER NOT NULL DEFAULT 0,
  last_tx_sig     TEXT,
  last_accrued_at INTEGER NOT NULL,
  last_paid_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_pending_enqueued ON pending(enqueued_at);
CREATE INDEX IF NOT EXISTS idx_accruals_unpaid ON accruals(wallet_address) WHERE accrued > paid;
`;

/** Build a persistent CoordinatorStore backed by SQLite at `file`. */
export function createSqliteStore(file: string): CoordinatorStore {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec(DDL);

  const metaRow = db
    .prepare('SELECT value FROM meta WHERE key = ?')
    .get('schema_version') as { value: string } | undefined;
  if (!metaRow) {
    db.prepare('INSERT INTO meta(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION),
    );
  } else {
    const onDisk = Number(metaRow.value);
    if (onDisk > SCHEMA_VERSION) {
      db.close();
      throw new Error(
        `sqlite db at ${file} was written by a newer schema (v${onDisk}); refusing to open with v${SCHEMA_VERSION}`,
      );
    }
    if (onDisk < SCHEMA_VERSION) {
      // v1 → v2 adds the accruals table. DDL above already CREATE TABLE IF NOT EXISTS'd it.
      db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(
        String(SCHEMA_VERSION),
        'schema_version',
      );
    }
  }

  const insertPending = db.prepare(
    'INSERT INTO pending(job_id, payload, enqueued_at) VALUES (?, ?, ?)',
  );
  const selectOldestPending = db.prepare(
    'SELECT id, payload FROM pending ORDER BY id ASC LIMIT 1',
  );
  const deletePending = db.prepare('DELETE FROM pending WHERE id = ?');
  const upsertResult = db.prepare(
    'INSERT INTO results(job_id, payload, recorded_at) VALUES (?, ?, ?) ' +
      'ON CONFLICT(job_id) DO UPDATE SET payload = excluded.payload, recorded_at = excluded.recorded_at',
  );
  const selectResult = db.prepare('SELECT payload FROM results WHERE job_id = ?');
  const selectAllResults = db.prepare('SELECT payload FROM results');
  const countPending = db.prepare('SELECT COUNT(*) AS n FROM pending');
  const countResults = db.prepare('SELECT COUNT(*) AS n FROM results');
  const begin = db.prepare('BEGIN IMMEDIATE');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');

  const creditAccrual = db.prepare(
    'INSERT INTO accruals(wallet_address, accrued, paid, last_accrued_at) VALUES (?, ?, 0, ?) ' +
      'ON CONFLICT(wallet_address) DO UPDATE SET ' +
      '  accrued = accrued + excluded.accrued, ' +
      '  last_accrued_at = excluded.last_accrued_at',
  );
  const selectAccrual = db.prepare('SELECT * FROM accruals WHERE wallet_address = ?');
  const selectAllAccruals = db.prepare('SELECT * FROM accruals');
  const selectUnpaidAccruals = db.prepare('SELECT * FROM accruals WHERE accrued > paid');
  const updatePaid = db.prepare(
    'UPDATE accruals SET paid = paid + ?, last_tx_sig = ?, last_paid_at = ? WHERE wallet_address = ?',
  );
  const countAccruals = db.prepare('SELECT COUNT(*) AS n FROM accruals');
  const countUnpaid = db.prepare('SELECT COUNT(*) AS n FROM accruals WHERE accrued > paid');

  let closed = false;

  const rowToAccrual = (row: Record<string, unknown>): AccrualRow => ({
    walletAddress: row['wallet_address'] as string,
    accrued: Number(row['accrued']),
    paid: Number(row['paid']),
    ...(row['last_tx_sig'] ? { lastTxSig: row['last_tx_sig'] as string } : {}),
    lastAccruedAt: Number(row['last_accrued_at']),
    ...(row['last_paid_at'] ? { lastPaidAt: Number(row['last_paid_at']) } : {}),
  });

  return {
    enqueue(job: Job) {
      insertPending.run(job.id, JSON.stringify(job), Date.now());
    },
    dequeue() {
      begin.run();
      try {
        const row = selectOldestPending.get() as { id: number; payload: string } | undefined;
        if (!row) {
          commit.run();
          return null;
        }
        deletePending.run(row.id);
        commit.run();
        return JobSchema.parse(JSON.parse(row.payload));
      } catch (err) {
        rollback.run();
        throw err;
      }
    },
    recordResult(result: Result) {
      upsertResult.run(result.jobId, JSON.stringify(result), Date.now());
    },
    getResult(jobId: string) {
      const row = selectResult.get(jobId) as { payload: string } | undefined;
      if (!row) return null;
      return ResultSchema.parse(JSON.parse(row.payload));
    },
    listResults() {
      const rows = selectAllResults.all() as Array<{ payload: string }>;
      return rows.map((r) => ResultSchema.parse(JSON.parse(r.payload)));
    },

    creditEarnings(walletAddress: string, amount: number, at: number = Date.now()) {
      if (amount <= 0 || !walletAddress) return;
      creditAccrual.run(walletAddress, amount, at);
    },
    getAccrual(walletAddress: string) {
      const row = selectAccrual.get(walletAddress) as Record<string, unknown> | undefined;
      return row ? rowToAccrual(row) : null;
    },
    listAccruals() {
      const rows = selectAllAccruals.all() as Array<Record<string, unknown>>;
      return rows.map(rowToAccrual);
    },
    listUnpaid() {
      const rows = selectUnpaidAccruals.all() as Array<Record<string, unknown>>;
      return rows.map(rowToAccrual);
    },
    markPaid(walletAddress: string, amount: number, txSig: string, at: number = Date.now()) {
      if (amount <= 0) return;
      const row = selectAccrual.get(walletAddress) as Record<string, unknown> | undefined;
      if (!row) {
        throw new Error(`cannot mark paid: ${walletAddress} has no accrual row`);
      }
      updatePaid.run(amount, txSig, at, walletAddress);
    },

    stats() {
      const p = (countPending.get() as { n: number }).n;
      const c = (countResults.get() as { n: number }).n;
      const a = (countAccruals.get() as { n: number }).n;
      const u = (countUnpaid.get() as { n: number }).n;
      return { pending: p, completed: c, addresses: a, unpaidAddresses: u };
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
