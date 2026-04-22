import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { estimateTokens, runJob } from '../src/worker.js';
import { PROTOCOL_VERSION, type Job } from '../src/protocol.js';

const baseJob: Job = {
  id: 'j-1',
  protocolVersion: PROTOCOL_VERSION,
  kind: 'completion',
  model: 'llama3.2',
  prompt: 'Count to five.',
  maxTokens: 32,
  temperature: 0.7,
  payout: 0.01,
  createdAt: Date.now(),
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('worker', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns a Result on ollama success', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({
        response: '1, 2, 3, 4, 5',
        done: true,
        prompt_eval_count: 4,
        eval_count: 7,
      }),
    );
    const r = await runJob(baseJob, { ollamaUrl: 'http://127.0.0.1:11434', nodeId: 'NODE #0001' });
    expect(r.jobId).toBe('j-1');
    expect(r.output).toBe('1, 2, 3, 4, 5');
    expect(r.tokensIn).toBe(4);
    expect(r.tokensOut).toBe(7);
    expect(r.payout).toBeCloseTo(11 / 1000);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('throws when ollama returns non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('bad', { status: 500 }));
    await expect(
      runJob(baseJob, { ollamaUrl: 'http://127.0.0.1:11434', nodeId: 'NODE #0001' }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('applies custom price function', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse({ response: 'ok', prompt_eval_count: 1, eval_count: 1 }),
    );
    const r = await runJob(baseJob, {
      ollamaUrl: 'http://127.0.0.1:11434',
      nodeId: 'NODE #0001',
      priceFn: (tin, tout) => (tin + tout) * 42,
    });
    expect(r.payout).toBe(84);
  });

  it('estimateTokens is roughly 1/4 of char count', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('a'.repeat(100))).toBe(25);
    expect(estimateTokens('')).toBe(1);
  });
});
