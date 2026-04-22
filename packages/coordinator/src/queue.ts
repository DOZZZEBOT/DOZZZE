// In-memory FIFO queue for jobs + a by-id result store.
// MVP simplicity: a single process, no persistence, no replication.
// Replaced by Durable Objects / Redis when the coordinator moves off single-node.
import type { Job, Result } from '@dozzze/sdk';

export interface CoordinatorStore {
  enqueue(job: Job): void;
  dequeue(): Job | null;
  recordResult(result: Result): void;
  getResult(jobId: string): Result | null;
  listResults(): readonly Result[];
  /** Snapshot counts — handy for health checks / tests. */
  stats(): { pending: number; completed: number };
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
    stats() {
      return { pending: pending.length, completed: results.size };
    },
  };
}
