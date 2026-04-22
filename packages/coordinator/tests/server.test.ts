import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Result } from '@dozzze/sdk';
import { createApp } from '../src/server.js';

function deterministicIds(): () => string {
  let n = 0;
  return () => `job-${++n}`;
}

function validSubmit(overrides: Record<string, unknown> = {}): object {
  return {
    protocolVersion: PROTOCOL_VERSION,
    kind: 'completion',
    model: 'llama3.2',
    prompt: 'Hello?',
    payout: 0.01,
    ...overrides,
  };
}

function validResult(jobId: string): Result {
  return {
    jobId,
    protocolVersion: PROTOCOL_VERSION,
    nodeId: 'NODE #0069',
    output: 'hi',
    tokensIn: 2,
    tokensOut: 1,
    durationMs: 10,
    payout: 0.003,
    completedAt: Date.now(),
  };
}

describe('server', () => {
  it('health returns protocol version and stats', async () => {
    const { app } = createApp();
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; protocolVersion: number; pending: number };
    expect(body.ok).toBe(true);
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(body.pending).toBe(0);
  });

  it('submit → poll round-trips a job', async () => {
    const { app } = createApp({ idFactory: deterministicIds() });
    const submitRes = await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSubmit()),
    });
    expect(submitRes.status).toBe(201);
    const submitted = (await submitRes.json()) as { job: { id: string; prompt: string } };
    expect(submitted.job.id).toBe('job-1');
    expect(submitted.job.prompt).toBe('Hello?');

    const pollRes = await app.request('/poll/NODE-1');
    expect(pollRes.status).toBe(200);
    const polled = (await pollRes.json()) as { job: { id: string } | null };
    expect(polled.job?.id).toBe('job-1');

    // Queue is now empty
    const empty = await app.request('/poll/NODE-1');
    expect(((await empty.json()) as { job: unknown }).job).toBeNull();
  });

  it('submit rejects a malformed body', async () => {
    const { app } = createApp();
    const res = await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bogus: true }),
    });
    expect(res.status).toBe(400);
  });

  it('poll rejects empty nodeId', async () => {
    const { app } = createApp();
    const res = await app.request('/poll/%20');
    expect(res.status).toBe(400);
  });

  it('report stores a result and /result/:jobId returns it', async () => {
    const { app } = createApp({ idFactory: deterministicIds() });
    // Submit first so the job exists in reality (though the server does not
    // currently enforce that a report references an enqueued job).
    await app.request('/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validSubmit()),
    });
    const rep = await app.request('/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: validResult('job-1') }),
    });
    expect(rep.status).toBe(201);

    const got = await app.request('/result/job-1');
    expect(got.status).toBe(200);
    const body = (await got.json()) as { result: { jobId: string } };
    expect(body.result.jobId).toBe('job-1');
  });

  it('result returns 404 when missing', async () => {
    const { app } = createApp();
    const res = await app.request('/result/never');
    expect(res.status).toBe(404);
  });

  it('FIFO across two pollers', async () => {
    const { app } = createApp({ idFactory: deterministicIds() });
    for (const prompt of ['one', 'two', 'three']) {
      await app.request('/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(validSubmit({ prompt })),
      });
    }
    const a = ((await (await app.request('/poll/A')).json()) as { job: { prompt: string } }).job;
    const b = ((await (await app.request('/poll/B')).json()) as { job: { prompt: string } }).job;
    const c = ((await (await app.request('/poll/A')).json()) as { job: { prompt: string } }).job;
    expect([a?.prompt, b?.prompt, c?.prompt]).toEqual(['one', 'two', 'three']);
  });
});
