// Consumer SDK. Thin HTTP client around the coordinator's public surface.
// Zero runtime deps beyond fetch — runs in Node 20+ and any modern browser.

import {
  PROTOCOL_VERSION,
  SubmitResponseSchema,
  PollResponseSchema,
  ResultSchema,
  type Result,
} from '@dozzze/sdk';
import { z } from 'zod';

const HealthResponseSchema = z.object({
  ok: z.boolean(),
  protocolVersion: z.number().int().positive(),
  authRequired: z.boolean().optional(),
  pending: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

const ResultLookupSchema = z.object({ result: ResultSchema });

export interface DozzzeClientOptions {
  /** Coordinator base URL (e.g. `http://127.0.0.1:8787`). */
  url: string;
  /** Bearer token. Required when the coordinator has auth enabled. */
  apiKey?: string;
  /** Custom fetch (injectable for tests). */
  fetchImpl?: typeof fetch;
}

export interface SubmitInput {
  kind?: 'chat' | 'completion';
  model: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** $DOZZZE the consumer is willing to pay. */
  payout: number;
}

export interface AwaitResultOptions {
  /** How long to wait for a result before throwing. Default: 120_000 ms. */
  timeoutMs?: number;
  /** How often to poll the coordinator. Default: 1000 ms. */
  pollMs?: number;
  /** AbortSignal the caller can use to cancel the await. */
  signal?: AbortSignal;
}

/** Error raised for every non-2xx response from the coordinator. */
export class DozzzeClientError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = 'DozzzeClientError';
    this.status = status;
    this.body = body;
  }
}

/** DOZZZE consumer client. One instance per coordinator. */
export class DozzzeClient {
  private readonly url: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: DozzzeClientOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** GET /health — returns protocol version + queue stats. */
  async health(): Promise<HealthResponse> {
    const res = await this.fetchImpl(`${this.url}/health`);
    await this.throwIfBad(res);
    return HealthResponseSchema.parse(await res.json());
  }

  /** POST /submit — returns the job id the coordinator assigned. */
  async submit(input: SubmitInput): Promise<string> {
    const body = {
      protocolVersion: PROTOCOL_VERSION,
      kind: input.kind ?? 'completion',
      model: input.model,
      prompt: input.prompt,
      maxTokens: input.maxTokens ?? 256,
      temperature: input.temperature ?? 0.7,
      payout: input.payout,
    };
    const res = await this.fetchImpl(`${this.url}/submit`, {
      method: 'POST',
      headers: this.headers({ json: true }),
      body: JSON.stringify(body),
    });
    await this.throwIfBad(res);
    const parsed = SubmitResponseSchema.parse(await res.json());
    return parsed.job.id;
  }

  /** GET /result/:jobId — returns the Result or null if not found. */
  async getResult(jobId: string): Promise<Result | null> {
    const res = await this.fetchImpl(`${this.url}/result/${encodeURIComponent(jobId)}`, {
      headers: this.headers(),
    });
    if (res.status === 404) {
      await res.text().catch(() => '');
      return null;
    }
    await this.throwIfBad(res);
    const parsed = ResultLookupSchema.parse(await res.json());
    return parsed.result;
  }

  /**
   * Poll /result/:jobId until a Result appears or the timeout elapses.
   * Throws `DozzzeClientError` with status=408 on timeout, status=0 on abort.
   */
  async awaitResult(jobId: string, opts: AwaitResultOptions = {}): Promise<Result> {
    const timeoutMs = opts.timeoutMs ?? 120_000;
    const pollMs = opts.pollMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (opts.signal?.aborted) {
        throw new DozzzeClientError('awaitResult aborted by caller', 0, null);
      }
      const r = await this.getResult(jobId);
      if (r) return r;
      await sleep(pollMs, opts.signal);
    }
    throw new DozzzeClientError(`awaitResult timeout after ${timeoutMs}ms`, 408, { jobId });
  }

  /** Convenience: submit then awaitResult in one call. */
  async submitAndAwait(input: SubmitInput, opts: AwaitResultOptions = {}): Promise<Result> {
    const jobId = await this.submit(input);
    return this.awaitResult(jobId, opts);
  }

  /** Validates /poll response shape — helper for testing integrations. */
  static parsePoll(raw: unknown): unknown {
    return PollResponseSchema.parse(raw);
  }

  private headers(opts: { json?: boolean } = {}): Record<string, string> {
    const h: Record<string, string> = {};
    if (opts.json) h['content-type'] = 'application/json';
    if (this.apiKey) h['authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async throwIfBad(res: Response): Promise<void> {
    if (res.ok) return;
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text().catch(() => '');
    }
    throw new DozzzeClientError(
      `coordinator ${res.status} ${res.statusText}`,
      res.status,
      body,
    );
  }
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(new DozzzeClientError('sleep aborted', 0, null));
    };
    const cleanup = (): void => {
      clearTimeout(t);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort);
    }
  });
}
