import { describe, expect, it } from 'vitest';
import {
  JobSchema,
  PROTOCOL_VERSION,
  parseJob,
  parseResult,
  ResultSchema,
} from '../src/protocol.js';

const validJob = {
  id: 'j-1',
  protocolVersion: PROTOCOL_VERSION,
  kind: 'completion',
  model: 'llama3.2',
  prompt: 'Hello?',
  maxTokens: 128,
  temperature: 0.7,
  payout: 0.01,
  createdAt: Date.now(),
};

const validResult = {
  jobId: 'j-1',
  protocolVersion: PROTOCOL_VERSION,
  nodeId: 'NODE #0069',
  output: 'Hi',
  tokensIn: 2,
  tokensOut: 1,
  durationMs: 123,
  payout: 0.003,
  completedAt: Date.now(),
};

describe('protocol', () => {
  it('accepts a valid job', () => {
    expect(parseJob(validJob).id).toBe('j-1');
  });

  it('rejects wrong protocol version', () => {
    expect(() => parseJob({ ...validJob, protocolVersion: 99 })).toThrow();
  });

  it('rejects empty prompt', () => {
    expect(() => parseJob({ ...validJob, prompt: '' })).toThrow();
  });

  it('clamps maxTokens to [1, 4096]', () => {
    expect(JobSchema.safeParse({ ...validJob, maxTokens: 5000 }).success).toBe(false);
    expect(JobSchema.safeParse({ ...validJob, maxTokens: 0 }).success).toBe(false);
    expect(JobSchema.safeParse({ ...validJob, maxTokens: 1 }).success).toBe(true);
  });

  it('accepts a valid result', () => {
    expect(parseResult(validResult).nodeId).toBe('NODE #0069');
  });

  it('rejects negative token counts', () => {
    expect(ResultSchema.safeParse({ ...validResult, tokensOut: -1 }).success).toBe(false);
  });
});
