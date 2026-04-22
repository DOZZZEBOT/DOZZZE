// `dozzze-coord distribute` — pays every accrued, unpaid row its share.
// Signs with the treasury keypair, creates ATAs on the fly, marks the
// ledger paid after on-chain confirmation.

import { readFile } from 'node:fs/promises';
import { Connection, Keypair, PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import type { CoordinatorStore } from '../queue.js';
import {
  buildTransferTx,
  chunkPlans,
  loadKeypairFromJson,
  proportionalSplit,
  type SplTransferPlan,
} from '../settlement-spl.js';

export interface DistributeOpts {
  store: CoordinatorStore;
  mint: string;
  cluster: 'devnet' | 'testnet' | 'mainnet-beta';
  rpcUrl?: string | undefined;
  /** Path to Solana CLI keypair JSON (array of 64 numbers). */
  treasuryKeypair: string;
  /** If set, distribute this many base units proportionally instead of 1:1. */
  pool?: bigint | undefined;
  /** Preview only — build everything, sign nothing. */
  dryRun?: boolean;
  /** Logger. Defaults to stdout. */
  log?: (msg: string) => void;
  /** Chunk size (transfers per on-chain tx). Defaults to 4. */
  chunkSize?: number;
}

export interface DistributeReport {
  attempted: number;
  succeeded: number;
  failed: Array<{ walletAddress: string; amount: bigint; reason: string }>;
  signatures: string[];
  residual: bigint;
}

const RPC_URL: Record<DistributeOpts['cluster'], string> = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

/** Run a distribution pass. Mutates the store (unless dryRun). */
export async function distribute(opts: DistributeOpts): Promise<DistributeReport> {
  const log = opts.log ?? ((m) => process.stdout.write(m + '\n'));
  const unpaid = opts.store.listUnpaid();
  if (unpaid.length === 0) {
    log('● nothing to distribute — no unpaid rows');
    return { attempted: 0, succeeded: 0, failed: [], signatures: [], residual: 0n };
  }

  const keypairJson = await readFile(opts.treasuryKeypair, 'utf8');
  const treasury = loadKeypairFromJson(keypairJson);
  const mint = new PublicKey(opts.mint);

  const outstanding = unpaid.map((r) => ({
    walletAddress: r.walletAddress,
    amount: Math.max(0, r.accrued - r.paid),
  }));

  // Decide how much each address gets in base units.
  let plans: SplTransferPlan[];
  let residual = 0n;
  let splitMap: Map<string, bigint>;
  if (opts.pool !== undefined) {
    const split = proportionalSplit(outstanding, opts.pool);
    residual = split.residual;
    splitMap = new Map(split.assignments.map((a) => [a.walletAddress, a.amount]));
    plans = split.assignments
      .filter((a) => a.amount > 0n)
      .map((a) => ({
        recipient: new PublicKey(a.walletAddress),
        amount: a.amount,
      }));
  } else {
    splitMap = new Map(outstanding.map((r) => [r.walletAddress, BigInt(r.amount)]));
    plans = outstanding
      .filter((r) => r.amount > 0)
      .map((r) => ({
        recipient: new PublicKey(r.walletAddress),
        amount: BigInt(r.amount),
      }));
  }

  log(`● ${plans.length} recipients, ${opts.pool !== undefined ? `${opts.pool} base units (proportional)` : '1:1 accrued → payout'}`);
  if (opts.pool !== undefined) log(`● residual (dust): ${residual}`);

  if (opts.dryRun) {
    for (const p of plans) log(`  ${p.recipient.toBase58()}  ${p.amount}`);
    return {
      attempted: plans.length,
      succeeded: 0,
      failed: [],
      signatures: [],
      residual,
    };
  }

  const rpcUrl = opts.rpcUrl && opts.rpcUrl.length > 0 ? opts.rpcUrl : RPC_URL[opts.cluster];
  const connection = new Connection(rpcUrl, 'confirmed');
  const chunks = chunkPlans(plans, opts.chunkSize ?? 4);
  const report: DistributeReport = {
    attempted: plans.length,
    succeeded: 0,
    failed: [],
    signatures: [],
    residual,
  };

  for (const chunk of chunks) {
    try {
      const tx = await buildTransferTx({
        connection,
        treasury,
        mint,
        plans: chunk,
      });
      const sig = await sendAndConfirmTransaction(connection, tx, [treasury]);
      report.signatures.push(sig);
      for (const p of chunk) {
        const addr = p.recipient.toBase58();
        const amount = splitMap.get(addr);
        if (amount === undefined) continue;
        opts.store.markPaid(addr, Number(amount), sig);
        report.succeeded += 1;
        log(`  ● paid ${addr} → ${amount} (tx ${sig.slice(0, 12)}…)`);
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      for (const p of chunk) {
        const addr = p.recipient.toBase58();
        const amount = splitMap.get(addr) ?? 0n;
        report.failed.push({ walletAddress: addr, amount, reason });
        log(`  × FAILED ${addr} (${amount}): ${reason}`);
      }
    }
  }

  log(`● done: ${report.succeeded} paid, ${report.failed.length} failed`);
  return report;
}
