// In-memory FIFO queue for jobs + result store + accrued-balance ledger.
// MVP simplicity: a single process, no replication. Persistence is opt-in
// via the SQLite implementation in store-sqlite.ts.
import type { Job, Result } from '@dozzze/sdk';

/** One row of the accrued-earnings ledger. */
export interface AccrualRow {
  walletAddress: string;
  /** Accrued amount in base units (no decimals applied yet — distribution scales). */
  accrued: number;
  /** Base units already paid out in prior `dozzze-coord distribute` runs. */
  paid: number;
  /** Last SPL transfer signature, if any. */
  lastTxSig?: string;
  /** Wall-clock ms of the last accrual credit. */
  lastAccruedAt: number;
  /** Wall-clock ms of the last successful payout. */
  lastPaidAt?: number;
}

export interface CoordinatorStore {
  enqueue(job: Job): void;
  dequeue(): Job | null;
  recordResult(result: Result): void;
  getResult(jobId: string): Result | null;
  listResults(): readonly Result[];

  /** Credit `amount` (base units) to `walletAddress`. Creates the row on first touch. */
  creditEarnings(walletAddress: string, amount: number, at?: number): void;
  /** Lookup one address's accrual row. Returns null if never credited. */
  getAccrual(walletAddress: string): AccrualRow | null;
  /** All ledger rows — for operator dashboards and the distribute command. */
  listAccruals(): readonly AccrualRow[];
  /** Rows with `accrued > paid` — the ones a distribute pass would touch. */
  listUnpaid(): readonly AccrualRow[];
  /** Record a successful payout: move `amount` from accrued→paid and stamp the tx signature. */
  markPaid(walletAddress: string, amount: number, txSig: string, at?: number): void;

  /** Snapshot counts — handy for health checks / tests. */
  stats(): { pending: number; completed: number; addresses: number; unpaidAddresses: number };
  /** Release any underlying resources. No-op for the in-memory store. */
  close?(): void;
}

/**
 * Build a fresh in-memory store. Call once per server process.
 * Jobs are strictly FIFO — the first one in wins the next poll.
 */
export function createStore(): CoordinatorStore {
  const pending: Job[] = [];
  const results = new Map<string, Result>();
  const ledger = new Map<string, AccrualRow>();

  return {
    enqueue(job) {
      pending.push(job);
    },
    dequeue() {
      return pending.shift() ?? null;
    },
    recordResult(result) {
      results.set(result.jobId, result);
    },
    getResult(jobId) {
      return results.get(jobId) ?? null;
    },
    listResults() {
      return Array.from(results.values());
    },

    creditEarnings(walletAddress, amount, at = Date.now()) {
      if (amount <= 0 || !walletAddress) return;
      const existing = ledger.get(walletAddress);
      if (existing) {
        existing.accrued += amount;
        existing.lastAccruedAt = at;
      } else {
        ledger.set(walletAddress, {
          walletAddress,
          accrued: amount,
          paid: 0,
          lastAccruedAt: at,
        });
      }
    },
    getAccrual(walletAddress) {
      const row = ledger.get(walletAddress);
      return row ? { ...row } : null;
    },
    listAccruals() {
      return Array.from(ledger.values()).map((r) => ({ ...r }));
    },
    listUnpaid() {
      return Array.from(ledger.values())
        .filter((r) => r.accrued > r.paid)
        .map((r) => ({ ...r }));
    },
    markPaid(walletAddress, amount, txSig, at = Date.now()) {
      const row = ledger.get(walletAddress);
      if (!row) {
        throw new Error(`cannot mark paid: ${walletAddress} has no accrual row`);
      }
      if (amount <= 0) return;
      row.paid += amount;
      row.lastTxSig = txSig;
      row.lastPaidAt = at;
    },

    stats() {
      let unpaid = 0;
      for (const r of ledger.values()) if (r.accrued > r.paid) unpaid += 1;
      return {
        pending: pending.length,
        completed: results.size,
        addresses: ledger.size,
        unpaidAddresses: unpaid,
      };
    },
  };
}
