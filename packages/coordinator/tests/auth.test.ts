import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@dozzze/sdk';
import { createApp } from '../src/server.js';
import { parseApiKeys } from '../src/auth.js';

function submitBody(): string {
  return JSON.stringify({
    protocolVersion: PROTOCOL_VERSION,
    kind: 'completion',
    model: 'llama3.2',
    prompt: 'hi',
    payout: 0.01,
  });
}

describe('auth', () => {
  it('parseApiKeys splits, trims, filters blanks', () => {
    expect(parseApiKeys(undefined)).toEqual([]);
    expect(parseApiKeys('')).toEqual([]);
    expect(parseApiKeys(' a , b ,, c ')).toEqual(['a', 'b', 'c']);
  });

  it('without keys configured, /submit is open', async () => {
    const { app } = createApp();
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: submitBody(),
    });
    expect(res.status).toBe(201);
  });

  it('with keys, missing Authorization → 401', async () => {
    const { app } = createApp({ apiKeys: ['top-secret'] });
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: submitBody(),
    });
    expect(res.status).toBe(401);
  });

  it('with keys, wrong bearer → 401', async () => {
    const { app } = createApp({ apiKeys: ['top-secret'] });
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer other' },
      body: submitBody(),
    });
    expect(res.status).toBe(401);
  });

  it('with keys, correct bearer → 201', async () => {
    const { app } = createApp({ apiKeys: ['top-secret'] });
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer top-secret' },
      body: submitBody(),
    });
    expect(res.status).toBe(201);
  });

  it('rate limit: returns 429 after N requests in a window', async () => {
    const { app } = createApp({
      apiKeys: ['top-secret'],
      rateLimit: 3,
      windowMs: 60_000,
    });
    const ok = (n: number) =>
      app.request('/submit', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer top-secret',
        },
        body: submitBody(),
      }).then((r) => ({ n, status: r.status }));
    const results = await Promise.all([ok(1), ok(2), ok(3), ok(4), ok(5)]);
    const statuses = results.map((r) => r.status);
    const limited = statuses.filter((s) => s === 429);
    expect(limited.length).toBe(2);
    expect(statuses.filter((s) => s === 201).length).toBe(3);
  });

  it('/poll is not auth-gated (read endpoint)', async () => {
    const { app } = createApp({ apiKeys: ['top-secret'] });
    const res = await app.request('/poll/NODE-1');
    expect(res.status).toBe(200);
  });

  it('/health reports authRequired=true when keys configured', async () => {
    const { app } = createApp({ apiKeys: ['x'] });
    const res = await app.request('/health');
    const body = (await res.json()) as { authRequired: boolean };
    expect(body.authRequired).toBe(true);
  });
});
