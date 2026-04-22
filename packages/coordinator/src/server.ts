// Hono app factory. Builds a fresh app bound to a given store + auth policy
// so tests can run isolated instances without sharing state.
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import {
  PROTOCOL_VERSION,
  ReportRequestSchema,
  SubmitRequestSchema,
  type Job,
} from '@dozzze/sdk';
import { createStore, type CoordinatorStore } from './queue.js';
import { bearerAuth } from './auth.js';

export interface CoordinatorOptions {
  store?: CoordinatorStore;
  now?: () => number;
  /** Injectable id generator for deterministic tests. */
  idFactory?: () => string;
  /** Bearer tokens allowed to POST /submit and /report. Empty = no auth. */
  apiKeys?: readonly string[];
  /** Per-key rate limit (requests per windowMs). */
  rateLimit?: number;
  /** Rate-limit window in ms. */
  windowMs?: number;
  /** Max ms /poll will wait for a job before returning {job:null}. Default: 0 = immediate. */
  longPollMs?: number;
  /** (tokensIn, tokensOut) → accrual amount in base units. */
  payoutFormula?: (tokensIn: number, tokensOut: number) => number;
}

/** Build a Hono app. Exported for direct testing with `app.request(...)`. */
export function createApp(opts: CoordinatorOptions = {}): {
  app: Hono;
  store: CoordinatorStore;
} {
  const store = opts.store ?? createStore();
  const now = opts.now ?? Date.now;
  const idFactory = opts.idFactory ?? randomUUID;
  const app = new Hono();
  const auth = bearerAuth({
    apiKeys: opts.apiKeys ?? [],
    ...(opts.rateLimit !== undefined ? { rateLimit: opts.rateLimit } : {}),
    ...(opts.windowMs !== undefined ? { windowMs: opts.windowMs } : {}),
  });
  const longPollMs = Math.max(0, opts.longPollMs ?? 0);

  // Payout formula: base units to credit per (tokensIn, tokensOut). Override
  // via `opts.payoutFormula` for tests or for a post-token-launch rate card.
  const payoutFormula =
    opts.payoutFormula ?? ((tokensIn: number, tokensOut: number) => tokensIn + tokensOut * 2);

  app.get('/health', (c) =>
    c.json({
      ok: true,
      protocolVersion: PROTOCOL_VERSION,
      authRequired: (opts.apiKeys ?? []).length > 0,
      ...store.stats(),
    }),
  );

  // Public read: a node checks its own accrual.
  app.get('/balance/:address', (c) => {
    const row = store.getAccrual(c.req.param('address'));
    if (!row) return c.json({ accrued: 0, paid: 0, outstanding: 0 });
    return c.json({
      walletAddress: row.walletAddress,
      accrued: row.accrued,
      paid: row.paid,
      outstanding: Math.max(0, row.accrued - row.paid),
      ...(row.lastTxSig ? { lastTxSig: row.lastTxSig } : {}),
      lastAccruedAt: row.lastAccruedAt,
      ...(row.lastPaidAt ? { lastPaidAt: row.lastPaidAt } : {}),
    });
  });

  // Operator read: the whole ledger. Auth-gated when keys configured.
  app.get('/balances', auth, (c) => {
    return c.json({ rows: store.listAccruals() });
  });

  // Consumer submits a new job. Auth-gated when keys are configured.
  app.post('/submit', auth, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = SubmitRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid submit request', issues: parsed.error.issues }, 400);
    }
    const job: Job = {
      id: idFactory(),
      protocolVersion: PROTOCOL_VERSION,
      kind: parsed.data.kind,
      model: parsed.data.model,
      prompt: parsed.data.prompt,
      maxTokens: parsed.data.maxTokens,
      temperature: parsed.data.temperature,
      payout: parsed.data.payout,
      createdAt: now(),
    };
    store.enqueue(job);
    return c.json({ job }, 201);
  });

  // Node polls for the next job. Supports long-polling: when the queue is
  // empty and longPollMs > 0, we block up to that long before returning
  // {job:null}. Keeps reaction time low without drowning the server in polls.
  app.get('/poll/:nodeId', async (c) => {
    const nodeId = c.req.param('nodeId');
    if (!nodeId || nodeId.trim().length === 0) {
      return c.json({ error: 'nodeId required' }, 400);
    }
    let job = store.dequeue();
    if (!job && longPollMs > 0) {
      const deadline = now() + longPollMs;
      while (!job && now() < deadline) {
        await new Promise((r) => setTimeout(r, 250));
        job = store.dequeue();
      }
    }
    return c.json({ job });
  });

  // Node reports a completed result. Auth-gated. If the Result carries a
  // walletAddress, credit the node's accrual ledger by the configured payout
  // formula. Nodes without a wallet address are still accepted — their work
  // is recorded but no payout accrues.
  app.post('/report', auth, async (c) => {
    const raw = await c.req.json().catch(() => null);
    const parsed = ReportRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid report', issues: parsed.error.issues }, 400);
    }
    const result = parsed.data.result;
    store.recordResult(result);
    let credited = 0;
    if (result.walletAddress) {
      credited = Math.max(0, Math.floor(payoutFormula(result.tokensIn, result.tokensOut)));
      if (credited > 0) {
        store.creditEarnings(result.walletAddress, credited, now());
      }
    }
    return c.json({ accepted: true, result, credited }, 201);
  });

  // Consumer fetches the result for a job they submitted earlier.
  app.get('/result/:jobId', (c) => {
    const jobId = c.req.param('jobId');
    const result = store.getResult(jobId);
    if (!result) return c.json({ error: 'not found' }, 404);
    return c.json({ result });
  });

  return { app, store };
}
