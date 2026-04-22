import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStore, type CoordinatorStore } from '../src/queue.js';
import { createSqliteStore } from '../src/store-sqlite.js';

function accrualCases(
  name: string,
  build: () => CoordinatorStore,
  teardown: () => void = () => undefined,
): void {
  describe(name, () => {
    let s: CoordinatorStore;

    beforeEach(() => {
      s = build();
    });

    afterEach(() => {
      s.close?.();
      teardown();
    });

    it('creditEarnings creates a row on first touch', () => {
      s.creditEarnings('addr-1', 100, 1_000);
      const row = s.getAccrual('addr-1');
      expect(row?.accrued).toBe(100);
      expect(row?.paid).toBe(0);
      expect(row?.lastAccruedAt).toBe(1_000);
    });

    it('creditEarnings sums on subsequent calls', () => {
      s.creditEarnings('addr-1', 100, 1_000);
      s.creditEarnings('addr-1', 50, 2_000);
      expect(s.getAccrual('addr-1')?.accrued).toBe(150);
      expect(s.getAccrual('addr-1')?.lastAccruedAt).toBe(2_000);
    });

    it('creditEarnings ignores zero/negative/empty', () => {
      s.creditEarnings('addr-1', 0);
      s.creditEarnings('addr-1', -5);
      s.creditEarnings('', 100);
      expect(s.getAccrual('addr-1')).toBeNull();
    });

    it('listAccruals returns everything', () => {
      s.creditEarnings('a', 10);
      s.creditEarnings('b', 20);
      const all = s.listAccruals();
      expect(all.map((r) => r.walletAddress).sort()).toEqual(['a', 'b']);
    });

    it('listUnpaid filters paid-up rows', () => {
      s.creditEarnings('a', 10);
      s.creditEarnings('b', 20);
      s.markPaid('a', 10, 'sig-a', 3_000);
      const unpaid = s.listUnpaid();
      expect(unpaid.map((r) => r.walletAddress)).toEqual(['b']);
    });

    it('markPaid increments paid and stamps tx', () => {
      s.creditEarnings('a', 100);
      s.markPaid('a', 40, 'sig-1', 5_000);
      const row = s.getAccrual('a');
      expect(row?.paid).toBe(40);
      expect(row?.lastTxSig).toBe('sig-1');
      expect(row?.lastPaidAt).toBe(5_000);
      // Second mark adds, not replaces.
      s.markPaid('a', 30, 'sig-2', 6_000);
      expect(s.getAccrual('a')?.paid).toBe(70);
      expect(s.getAccrual('a')?.lastTxSig).toBe('sig-2');
    });

    it('markPaid throws on an unknown address', () => {
      expect(() => s.markPaid('missing', 10, 'sig')).toThrow();
    });

    it('stats track addresses + unpaidAddresses', () => {
      s.creditEarnings('a', 10);
      s.creditEarnings('b', 20);
      s.markPaid('a', 10, 'sig');
      const st = s.stats();
      expect(st.addresses).toBe(2);
      expect(st.unpaidAddresses).toBe(1);
    });
  });
}

accrualCases('in-memory accruals', () => createStore());

describe('sqlite accruals (persistence across reopen)', () => {
  let tmp: string;
  let dbFile: string;
  const opened: CoordinatorStore[] = [];
  const open = (): CoordinatorStore => {
    const s = createSqliteStore(dbFile);
    opened.push(s);
    return s;
  };

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'dozzze-acc-'));
    dbFile = join(tmp, 'coord.sqlite');
  });

  afterEach(async () => {
    while (opened.length > 0) opened.pop()?.close?.();
    await rm(tmp, { recursive: true, force: true });
  });

  it('accrual + payout survive reopen', () => {
    const s1 = open();
    s1.creditEarnings('a', 100, 1_000);
    s1.markPaid('a', 40, 'sig-1', 2_000);
    s1.close?.();
    const s2 = open();
    const row = s2.getAccrual('a');
    expect(row?.accrued).toBe(100);
    expect(row?.paid).toBe(40);
    expect(row?.lastTxSig).toBe('sig-1');
  });
});
