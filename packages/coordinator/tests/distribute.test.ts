import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createStore } from '../src/queue.js';
import { distribute } from '../src/commands/distribute.js';

// Real mainnet addresses would require live RPC; dry-run mode exercises the
// planning path end-to-end without a socket.

describe('distribute (dry run)', () => {
  let tmp: string;
  let keypairFile: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dozzze-dist-'));
    const kp = Keypair.generate();
    keypairFile = join(tmp, 'treasury.json');
    await writeFile(keypairFile, JSON.stringify(Array.from(kp.secretKey)), 'utf8');
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it('returns early when nothing is unpaid', async () => {
    const store = createStore();
    const logs: string[] = [];
    const report = await distribute({
      store,
      mint: Keypair.generate().publicKey.toBase58(),
      cluster: 'devnet',
      treasuryKeypair: keypairFile,
      dryRun: true,
      log: (m) => logs.push(m),
    });
    expect(report.attempted).toBe(0);
    expect(logs.some((l) => l.includes('nothing to distribute'))).toBe(true);
  });

  it('dry-run prints every recipient with 1:1 amounts', async () => {
    const store = createStore();
    const a = Keypair.generate().publicKey.toBase58();
    const b = Keypair.generate().publicKey.toBase58();
    store.creditEarnings(a, 100);
    store.creditEarnings(b, 300);

    const logs: string[] = [];
    const report = await distribute({
      store,
      mint: Keypair.generate().publicKey.toBase58(),
      cluster: 'devnet',
      treasuryKeypair: keypairFile,
      dryRun: true,
      log: (m) => logs.push(m),
    });
    expect(report.attempted).toBe(2);
    expect(report.succeeded).toBe(0);
    expect(logs.some((l) => l.includes(a) && l.includes('100'))).toBe(true);
    expect(logs.some((l) => l.includes(b) && l.includes('300'))).toBe(true);
    // Nothing should be marked paid in a dry run.
    expect(store.getAccrual(a)?.paid).toBe(0);
    expect(store.getAccrual(b)?.paid).toBe(0);
  });

  it('dry-run with --pool splits proportionally', async () => {
    const store = createStore();
    const a = Keypair.generate().publicKey.toBase58();
    const b = Keypair.generate().publicKey.toBase58();
    store.creditEarnings(a, 100);
    store.creditEarnings(b, 300);

    const logs: string[] = [];
    const report = await distribute({
      store,
      mint: Keypair.generate().publicKey.toBase58(),
      cluster: 'devnet',
      treasuryKeypair: keypairFile,
      pool: 4_000n,
      dryRun: true,
      log: (m) => logs.push(m),
    });
    expect(report.attempted).toBe(2);
    // a gets 100/400 × 4000 = 1000, b gets 300/400 × 4000 = 3000
    expect(logs.some((l) => l.includes(a) && l.includes('1000'))).toBe(true);
    expect(logs.some((l) => l.includes(b) && l.includes('3000'))).toBe(true);
    expect(report.residual).toBe(0n);
  });

  it('rejects a bogus keypair file cleanly', async () => {
    const store = createStore();
    const a = Keypair.generate().publicKey.toBase58();
    store.creditEarnings(a, 100);
    const bogus = join(tmp, 'bogus.json');
    await writeFile(bogus, '{"not":"an array"}', 'utf8');
    await expect(
      distribute({
        store,
        mint: Keypair.generate().publicKey.toBase58(),
        cluster: 'devnet',
        treasuryKeypair: bogus,
        dryRun: true,
        log: () => undefined,
      }),
    ).rejects.toThrow();
  });
});
