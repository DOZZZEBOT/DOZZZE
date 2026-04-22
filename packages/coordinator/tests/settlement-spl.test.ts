import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  chunkPlans,
  loadKeypairFromJson,
  proportionalSplit,
} from '../src/settlement-spl.js';

describe('proportionalSplit', () => {
  it('splits 10+30 over pool=1000 → 250/750 (floored)', () => {
    const { assignments, residual } = proportionalSplit(
      [
        { walletAddress: 'a', amount: 10 },
        { walletAddress: 'b', amount: 30 },
      ],
      1000n,
    );
    expect(assignments).toEqual([
      { walletAddress: 'a', amount: 250n },
      { walletAddress: 'b', amount: 750n },
    ]);
    expect(residual).toBe(0n);
  });

  it('flooring produces a positive residual for non-clean divisions', () => {
    const { assignments, residual } = proportionalSplit(
      [
        { walletAddress: 'a', amount: 1 },
        { walletAddress: 'b', amount: 1 },
        { walletAddress: 'c', amount: 1 },
      ],
      100n,
    );
    expect(assignments.every((a) => a.amount === 33n)).toBe(true);
    expect(residual).toBe(1n); // 100 - 99
  });

  it('empty rows return the full pool as residual', () => {
    const { assignments, residual } = proportionalSplit([], 500n);
    expect(assignments).toEqual([]);
    expect(residual).toBe(500n);
  });

  it('all-zero rows return the full pool as residual', () => {
    const { assignments, residual } = proportionalSplit(
      [{ walletAddress: 'a', amount: 0 }],
      500n,
    );
    expect(assignments).toEqual([]);
    expect(residual).toBe(500n);
  });
});

describe('chunkPlans', () => {
  it('slices into chunkSize-size arrays', () => {
    expect(chunkPlans([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7],
    ]);
  });

  it('returns empty on empty input', () => {
    expect(chunkPlans([], 4)).toEqual([]);
  });

  it('throws on bad chunk size', () => {
    expect(() => chunkPlans([1], 0)).toThrow();
  });
});

describe('loadKeypairFromJson', () => {
  it('round-trips a Solana CLI keypair JSON', () => {
    const kp = Keypair.generate();
    const json = JSON.stringify(Array.from(kp.secretKey));
    const loaded = loadKeypairFromJson(json);
    expect(loaded.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('rejects non-array JSON', () => {
    expect(() => loadKeypairFromJson('{"hi":1}')).toThrow();
  });

  it('rejects wrong-length array', () => {
    expect(() => loadKeypairFromJson(JSON.stringify([1, 2, 3]))).toThrow();
  });
});
