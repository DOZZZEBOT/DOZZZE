import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type Job, type Result } from '@dozzze/sdk';
import { reportResult, startHttpCoordinator } from '../src/coordinator-http.js';

const validJob: Job = {
  id: 'j-1',
  protocolVersion: PROTOCOL_VERSION,
  kind: 'completion',
  model: 'llama3.2',
  prompt: 'hi',
  maxTokens: 128,
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

describe('coordinator-http', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.useFakeTimers();
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.useRealTimers();
  });

  it('startHttpCoordinator fires onJob for each job returned', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ job: validJob }));
    const seen: string[] = [];
    const stop = startHttpCoordinator({
      url: 'http://127.0.0.1:8787',
      nodeId: 'NODE #0001',
      intervalMs: 1000,
      onJob: (j) => {
        seen.push(j.id);
      },
    });
    // The initial tick fires immediately — let the promise microtask settle.
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();
    expect(seen[0]).toBe('j-1');
    stop();
  });

  it('skips onJob when the coordinator says job=null', async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ job: null }));
    const onJob = vi.fn();
    const stop = startHttpCoordinator({
      url: 'http://127.0.0.1:8787',
      nodeId: 'NODE #0001',
      intervalMs: 1000,
      onJob,
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(onJob).not.toHaveBeenCalled();
    stop();
  });

  it('surfaces fetch errors to onError without throwing', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));
    const errors: string[] = [];
    const stop = startHttpCoordinator({
      url: 'http://127.0.0.1:8787',
      nodeId: 'N',
      intervalMs: 1000,
      onJob: () => {
        throw new Error('should not fire');
      },
      onError: (e) => {
        errors.push(e.message);
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(errors[0]).toContain('ECONNREFUSED');
    stop();
  });

  it('reportResult POSTs the result and resolves on 201', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 201 }));
    const r: Result = {
      jobId: 'j-1',
      protocolVersion: PROTOCOL_VERSION,
      nodeId: 'NODE #0069',
      output: 'hi',
      tokensIn: 1,
      tokensOut: 1,
      durationMs: 10,
      payout: 0.002,
      completedAt: Date.now(),
    };
    await expect(reportResult('http://127.0.0.1:8787', r)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/report',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('reportResult throws on non-2xx', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    const r: Result = {
      jobId: 'j-1',
      protocolVersion: PROTOCOL_VERSION,
      nodeId: 'NODE #0069',
      output: '',
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      payout: 0,
      completedAt: Date.now(),
    };
    await expect(reportResult('http://127.0.0.1:8787', r)).rejects.toThrow(/HTTP 500/);
  });
});
