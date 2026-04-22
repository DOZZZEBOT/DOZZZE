import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type Result } from '@dozzze/sdk';
import { buildMemoPayload, rpcUrlFor } from '../src/settlement.js';

const sampleResult: Result = {
  jobId: '11111111-2222-3333-4444-555555555555',
  protocolVersion: PROTOCOL_VERSION,
  nodeId: 'NODE #0069',
  output: 'ignored',
  tokensIn: 12,
  tokensOut: 34,
  durationMs: 100,
  payout: 0.046,
  completedAt: 1745000000000,
};

describe('settlement', () => {
  it('memo payload is prefixed and compact', () => {
    const memo = buildMemoPayload(sampleResult);
    expect(memo.startsWith('dozzze:v1:')).toBe(true);
    const json = JSON.parse(memo.slice('dozzze:v1:'.length)) as {
      j: string;
      n: string;
      t: number;
      p: number;
      c: number;
    };
    expect(json.j).toBe(sampleResult.jobId);
    expect(json.n).toBe('NODE #0069');
    expect(json.t).toBe(46); // tokensIn + tokensOut
    expect(json.p).toBe(0.046);
    expect(json.c).toBe(1745000000000);
  });

  it('memo payload trims payout to 6 decimals', () => {
    const r: Result = { ...sampleResult, payout: 0.123456789 };
    const memo = buildMemoPayload(r);
    const json = JSON.parse(memo.slice('dozzze:v1:'.length)) as { p: number };
    expect(json.p).toBe(0.123457);
  });

  it('rpcUrlFor maps clusters to canonical URLs', () => {
    expect(rpcUrlFor('devnet')).toBe('https://api.devnet.solana.com');
    expect(rpcUrlFor('testnet')).toBe('https://api.testnet.solana.com');
    expect(rpcUrlFor('mainnet-beta')).toBe('https://api.mainnet-beta.solana.com');
  });

  it('rpcUrlFor honors an explicit override', () => {
    expect(rpcUrlFor('devnet', 'https://custom.rpc')).toBe('https://custom.rpc');
  });
});
