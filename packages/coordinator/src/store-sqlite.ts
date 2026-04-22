// SQLite-backed CoordinatorStore using Node's built-in `node:sqlite` (v22+).
// Opt-in via the --db CLI flag or DOZZZE_COORD_DB env var. Survives restarts;
// still single-writer (fine for MVP — the queue is not a hot path).
//
// Node's sqlite module is marked experimental but API-stable enough for MVP.
// When it graduates to stable, we can drop the ExperimentalWarning suppression.
//
// Schema is forward-compatible: a `meta` table tracks the written schema
// version so future releases can migrate instead of throwing on old rows.

// Use createRequire to pull in `node:sqlite` at runtime. This avoids Vite's
// module graph (which strips the `node:` prefix for non-builtin modules and
// then tries to resolve the bare "sqlite" name as an npm package, failing).
import { createRequire } from 'node:module';
import { JobSchema, ResultSchema, type Job, type Result } from '@dozzze/sdk';
import type { CoordinatorStore } from './queue.js';

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

const SCHEMA_VERSION = 1;

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
CREATE INDEX IF NOT EXISTS idx_pending_enqueued ON pending(enqueued_at);
`;

/** Build a persistent CoordinatorStore backed by SQLite at `file`. */
export function createSqliteStore(file: string): CoordinatorStore {
  const db = new DatabaseSync(file);
  // WAL + normal sync gives durability without blowing the latency budget.
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
  } else if (Number(metaRow.value) > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      `sqlite db at ${file} was written by a newer schema (v${metaRow.value}); refusing to open with v${SCHEMA_VERSION}`,
    );
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

  let closed = false;

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
    stats() {
      const p = (countPending.get() as { n: number }).n;
      const c = (countResults.get() as { n: number }).n;
      return { pending: p, completed: c };
    },
    close() {
      if (closed) return;
      closed = true;
      db.close();
    },
  };
}
