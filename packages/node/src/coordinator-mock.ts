// A fake coordinator that fires a synthesized Job at a fixed cadence. Lets a
// fresh install of `dozzze start` do something visible within 30 seconds.
// Replaced by a real HTTP/SSE coordinator in v0.2.

import { randomUUID } from 'node:crypto';
import type { Job } from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';

const SAMPLE_PROMPTS: readonly string[] = [
  'Summarize the last 24h of Solana memecoin flows in 3 bullet points.',
  'Read this token contract and flag any rug-pull patterns: function _transfer(...)',
  'Given these top 10 holders, estimate whether this is a concentrated bag or organic.',
  'Translate the tweet below into trading signals: "LFG new AI token just launched"',
  'What percent of pump.fun tokens survive 24h? Make a reasonable estimate with reasoning.',
];

function pick<T>(xs: readonly T[]): T {
  // Non-empty list is enforced by caller; assertion is safe.
  const idx = Math.floor(Math.random() * xs.length);
  return xs[idx] as T;
}

/** Builds a synthetic Job for mock testing. */
export function makeMockJob(model = 'llama3.2'): Job {
  return {
    id: randomUUID(),
    protocolVersion: PROTOCOL_VERSION,
    kind: 'completion',
    model,
    prompt: pick(SAMPLE_PROMPTS),
    maxTokens: 128,
    temperature: 0.7,
    payout: 0.01,
    createdAt: Date.now(),
  };
}

export interface MockCoordinatorOpts {
  intervalMs: number;
  model?: string;
  onJob: (job: Job) => void | Promise<void>;
}

/** Starts a timer that emits mock Jobs at `intervalMs`. Returns a stopper. */
export function startMockCoordinator(opts: MockCoordinatorOpts): () => void {
  const interval = setInterval(() => {
    const job = makeMockJob(opts.model);
    void Promise.resolve(opts.onJob(job)).catch((e: unknown) => {
      // eslint-disable-next-line no-console
      console.error('mock coordinator: onJob threw', e);
    });
  }, opts.intervalMs);

  // Don't keep Node alive just for this timer.
  interval.unref?.();

  return () => clearInterval(interval);
}
