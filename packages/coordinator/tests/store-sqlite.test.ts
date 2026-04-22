import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Job, type Result } from '@dozzze/sdk';
import { createSqliteStore } from '../src/store-sqlite.js';
import type { CoordinatorStore } from '../src/queue.js';

function j(id: string): Job {
  return {
    id,
    protocolVersion: PROTOCOL_VERSION,
    kind: 'completion',
    model: 'llama3.2',
    prompt: 'hi',
    maxTokens: 128,
    temperature: 0.7,
    payout: 0.01,
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

describe('sqlite store', () => {
  let tmp: string;
  let dbFile: string;
  const opened: CoordinatorStore[] = [];

  const open = (): CoordinatorStore => {
    const s = createSqliteStore(dbFile);
    opened.push(s);
    return s;
  };

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dozzze-coord-sqlite-'));
    dbFile = join(tmp, 'coord.sqlite');
  });

  afterEach(async () => {
    while (opened.length > 0) opened.pop()?.close?.();
    await rm(tmp, { recursive: true, force: true });
  });

  it('enqueue/dequeue preserves FIFO across process boundaries', () => {
    const s1 = open();
    s1.enqueue(j('a'));
    s1.enqueue(j('b'));
    s1.enqueue(j('c'));
    expect(s1.stats().pending).toBe(3);
    s1.close?.();

    // Simulate a restart: open a fresh store on the same file.
    const s2 = open();
    expect(s2.dequeue()?.id).toBe('a');
    expect(s2.dequeue()?.id).toBe('b');
    expect(s2.dequeue()?.id).toBe('c');
    expect(s2.dequeue()).toBeNull();
  });

  it('recordResult persists across reopen', () => {
    const s1 = open();
    s1.recordResult(r('x'));
    s1.close?.();
    const s2 = open();
    expect(s2.getResult('x')?.jobId).toBe('x');
  });

  it('recordResult with the same jobId overwrites', () => {
    const s = open();
    s.recordResult({ ...r('y'), payout: 0.001 });
    s.recordResult({ ...r('y'), payout: 0.999 });
    expect(s.getResult('y')?.payout).toBe(0.999);
  });

  it('stats track pending + completed', () => {
    const s = open();
    s.enqueue(j('a'));
    s.enqueue(j('b'));
    s.recordResult(r('z'));
    expect(s.stats()).toMatchObject({ pending: 2, completed: 1 });
  });

  it('listResults returns every recorded Result', () => {
    const s = open();
    s.recordResult(r('a'));
    s.recordResult(r('b'));
    const ids = s.listResults().map((x) => x.jobId).sort();
    expect(ids).toEqual(['a', 'b']);
  });
});
