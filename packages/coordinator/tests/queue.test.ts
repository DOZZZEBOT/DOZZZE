import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Job, type Result } from '@dozzze/sdk';
import { createStore } from '../src/queue.js';

function j(id: string, payout = 0.01): Job {
  return {
    id,
    protocolVersion: PROTOCOL_VERSION,
    kind: 'completion',
    model: 'llama3.2',
    prompt: 'hi',
    maxTokens: 128,
    temperature: 0.7,
    payout,
    createdAt: Date.now(),
  };
}

function r(jobId: string): Result {
  return {
    jobId,
    protocolVersion: PROTOCOL_VERSION,
    nodeId: 'NODE #0069',
    output: 'ok',
    tokensIn: 1,
    tokensOut: 1,
    durationMs: 10,
    payout: 0.002,
    completedAt: Date.now(),
  };
}

describe('queue', () => {
  it('is FIFO', () => {
    const s = createStore();
    s.enqueue(j('a'));
    s.enqueue(j('b'));
    s.enqueue(j('c'));
    expect(s.dequeue()?.id).toBe('a');
    expect(s.dequeue()?.id).toBe('b');
    expect(s.dequeue()?.id).toBe('c');
    expect(s.dequeue()).toBeNull();
  });

  it('records and retrieves results', () => {
    const s = createStore();
    s.recordResult(r('a'));
    expect(s.getResult('a')?.jobId).toBe('a');
    expect(s.getResult('zzz')).toBeNull();
  });

  it('overwrites when the same jobId is reported twice', () => {
    const s = createStore();
    s.recordResult({ ...r('a'), payout: 1 });
    s.recordResult({ ...r('a'), payout: 2 });
    expect(s.getResult('a')?.payout).toBe(2);
  });

  it('stats track pending + completed', () => {
    const s = createStore();
    s.enqueue(j('a'));
    s.enqueue(j('b'));
    s.recordResult(r('x'));
    expect(s.stats()).toEqual({ pending: 2, completed: 1 });
  });
});
