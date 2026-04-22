import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Result } from '@dozzze/sdk';
import { createApp } from '../src/server.js';

function validSubmit(): object {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'completion',
    model: 'llama3.2',
    prompt: 'hi',
    payout: 0.01,
  };
}

function result(jobId: string, walletAddress?: string): Result {
  return {
    jobId,
    protocolVersion: PROTOCOL_VERSION,
    nodeId: 'NODE #0042',
    ...(walletAddress ? { walletAddress } : {}),
    output: 'hi',
    tokensIn: 10,
    tokensOut: 20,
    durationMs: 50,
    payout: 0.05,
    completedAt: Date.now(),
  };
}

describe('balance API', () => {
  it('/report credits accrual when walletAddress is present', async () => {
    const { app, store } = createApp({
      // Deterministic formula: 1 per token in + 2 per token out.
      payoutFormula: (tin, tout) => tin + tout * 2,
    });
    await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSubmit()),
    });
    const res = await app.request('/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: result('j-1', 'wallet-abc') }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { credited: number };
    expect(body.credited).toBe(10 + 20 * 2);
    expect(store.getAccrual('wallet-abc')?.accrued).toBe(50);
  });

  it('/report does not credit when walletAddress is absent', async () => {
    const { app, store } = createApp();
    await app.request('/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: result('j-1') }),
    });
    expect(store.listAccruals().length).toBe(0);
  });

  it('/balance/:address returns zeros when unknown', async () => {
    const { app } = createApp();
    const res = await app.request('/balance/unknown-address');
    const body = (await res.json()) as { accrued: number; paid: number; outstanding: number };
    expect(body).toEqual({ accrued: 0, paid: 0, outstanding: 0 });
  });

  it('/balance/:address reports outstanding = accrued - paid', async () => {
    const { app, store } = createApp();
    store.creditEarnings('wallet-xyz', 100, 1_000);
    store.markPaid('wallet-xyz', 40, 'sig-1', 2_000);
    const res = await app.request('/balance/wallet-xyz');
    const body = (await res.json()) as {
      accrued: number;
      paid: number;
      outstanding: number;
      lastTxSig: string;
    };
    expect(body.accrued).toBe(100);
    expect(body.paid).toBe(40);
    expect(body.outstanding).toBe(60);
    expect(body.lastTxSig).toBe('sig-1');
  });

  it('/balances is auth-gated when keys are configured', async () => {
    const { app, store } = createApp({ apiKeys: ['op-secret'] });
    store.creditEarnings('a', 10);
    const unauth = await app.request('/balances');
    expect(unauth.status).toBe(401);
    const authed = await app.request('/balances', {
      headers: { authorization: 'Bearer op-secret' },
    });
    const body = (await authed.json()) as { rows: Array<{ walletAddress: string }> };
    expect(body.rows.map((r) => r.walletAddress)).toEqual(['a']);
  });
});
