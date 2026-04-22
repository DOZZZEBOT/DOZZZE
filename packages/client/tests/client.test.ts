import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type Result } from '@dozzze/sdk';
import { DozzzeClient, DozzzeClientError } from '../src/client.js';

const sampleResult: Result = {
  jobId: 'j-1',
  protocolVersion: PROTOCOL_VERSION,
  nodeId: 'NODE #0069',
  output: 'ok',
  tokensIn: 2,
  tokensOut: 3,
  durationMs: 50,
  payout: 0.005,
  completedAt: Date.now(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('DozzzeClient', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('health returns parsed stats', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        authRequired: false,
        pending: 3,
        completed: 2,
      }),
    );
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787' });
    const h = await c.health();
    expect(h.ok).toBe(true);
    expect(h.pending).toBe(3);
  });

  it('submit returns jobId + sends Authorization header when apiKey is set', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        {
          job: {
            id: 'j-abc',
            protocolVersion: PROTOCOL_VERSION,
            kind: 'completion',
            model: 'llama3.2',
            prompt: 'hi',
            maxTokens: 128,
            temperature: 0.7,
            payout: 0.01,
            createdAt: Date.now(),
          },
        },
        201,
      ),
    );
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787', apiKey: 'secret' });
    const id = await c.submit({ model: 'llama3.2', prompt: 'hi', payout: 0.01 });
    expect(id).toBe('j-abc');
    const call = fetchSpy.mock.calls[0];
    const init = call?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer secret');
    expect(headers['content-type']).toBe('application/json');
  });

  it('getResult returns null on 404 without throwing', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{}', { status: 404 }));
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787' });
    expect(await c.getResult('missing')).toBeNull();
  });

  it('non-2xx throws DozzzeClientError with status + body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'nope' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787' });
    const err = await c
      .submit({ model: 'x', prompt: 'y', payout: 0.01 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DozzzeClientError);
    expect((err as DozzzeClientError).status).toBe(429);
  });

  it('awaitResult polls until a result arrives', async () => {
    let calls = 0;
    fetchSpy.mockImplementation(async () => {
      calls += 1;
      if (calls < 3) return new Response('{}', { status: 404 });
      return jsonResponse({ result: sampleResult });
    });
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787' });
    const r = await c.awaitResult('j-1', { pollMs: 1, timeoutMs: 5_000 });
    expect(r.jobId).toBe('j-1');
    expect(calls).toBe(3);
  });

  it('awaitResult throws 408 on timeout', async () => {
    fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }));
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787' });
    const err = await c
      .awaitResult('j-1', { pollMs: 5, timeoutMs: 50 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DozzzeClientError);
    expect((err as DozzzeClientError).status).toBe(408);
  });

  it('submitAndAwait chains submit + awaitResult', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        jsonResponse(
          {
            job: {
              id: 'j-42',
              protocolVersion: PROTOCOL_VERSION,
              kind: 'completion',
              model: 'llama3.2',
              prompt: 'hi',
              maxTokens: 128,
              temperature: 0.7,
              payout: 0.01,
              createdAt: Date.now(),
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({ result: { ...sampleResult, jobId: 'j-42' } }),
      );
    const c = new DozzzeClient({ url: 'http://127.0.0.1:8787' });
    const r = await c.submitAndAwait(
      { model: 'llama3.2', prompt: 'hi', payout: 0.01 },
      { pollMs: 1, timeoutMs: 5_000 },
    );
    expect(r.jobId).toBe('j-42');
  });
});
