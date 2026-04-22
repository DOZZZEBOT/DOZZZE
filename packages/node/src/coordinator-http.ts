// HTTP poller for the real coordinator. Mirrors the surface of
// coordinator-mock.ts so router.ts can choose at runtime.
// Polling strategy: pull one job per tick, POST the result immediately.
// No SSE yet — keeps the coordinator stateless and dead-simple to scale.

import { PollResponseSchema, type Job, type Result } from '@dozzze/sdk';

export interface HttpCoordinatorOpts {
  url: string;
  nodeId: string;
  intervalMs: number;
  onJob: (job: Job) => void | Promise<void>;
  fetchImpl?: typeof fetch;
  /** Called on every fetch error so the CLI can log loudly. */
  onError?: (err: Error) => void;
}

/** Starts polling. Returns a stop function that clears the timer. */
export function startHttpCoordinator(opts: HttpCoordinatorOpts): () => void {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.url.replace(/\/+$/, '');
  const endpoint = `${base}/poll/${encodeURIComponent(opts.nodeId)}`;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.max(2_000, opts.intervalMs));
    try {
      const res = await fetchImpl(endpoint, { signal: ctrl.signal });
      if (!res.ok) {
        throw new Error(`coordinator /poll returned HTTP ${res.status}`);
      }
      const raw: unknown = await res.json();
      const parsed = PollResponseSchema.parse(raw);
      if (parsed.job) {
        await opts.onJob(parsed.job);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      opts.onError?.(e);
    } finally {
      clearTimeout(timer);
    }
  };

  const interval = setInterval(() => void tick(), opts.intervalMs);
  interval.unref?.();

  // Fire once immediately so the user does not wait a full tick for the first poll.
  void tick();

  return () => {
    stopped = true;
    clearInterval(interval);
  };
}

/** POSTs a Result to the coordinator's /report endpoint. */
export async function reportResult(
  url: string,
  result: Result,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const base = url.replace(/\/+$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetchImpl(`${base}/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      throw new Error(`coordinator /report returned HTTP ${res.status}: ${await res.text()}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
