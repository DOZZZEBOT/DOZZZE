// Build + sign the SPL transfer instructions the `distribute` command uses
// to pay accrued balances. Pure transaction-builder functions for the happy
// path. The CLI wraps these with a Connection + signer + retry loop.
//
// Design: treasury wallet holds $DOZZZE + SOL-for-gas. Each recipient gets a
// (source → recipient-ATA) transfer. ATAs are created on the fly if missing,
// billed to the treasury. This keeps nodes 100% passive — they never touch a
// transaction. Whatever rewards a node accrued, it just shows up in their
// wallet after the next distribute pass.

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import {
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddress,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';

export interface SplTransferPlan {
  /** Recipient wallet (user's Solana address). */
  recipient: PublicKey;
  /** Amount in base units (multiply display amount by 10^decimals). */
  amount: bigint;
}

export interface BuildTransferTxDeps {
  connection: Connection;
  treasury: Keypair;
  mint: PublicKey;
  plans: readonly SplTransferPlan[];
  /** Optional fee payer. Defaults to the treasury. */
  feePayer?: PublicKey;
}

/**
 * Build a single Transaction that pays out every plan in `plans`.
 * Caller still has to sign + send it; this keeps the function pure.
 *
 * Solana's tx size limit is ~1232 bytes. One transfer fits in ~200 bytes,
 * one ATA creation in ~550. The distribute command chunks plans before
 * calling this to stay under the limit.
 */
export async function buildTransferTx(deps: BuildTransferTxDeps): Promise<Transaction> {
  const { connection, treasury, mint, plans, feePayer = treasury.publicKey } = deps;
  if (plans.length === 0) throw new Error('no plans — refusing to build empty tx');

  const instructions: TransactionInstruction[] = [];
  const sourceAta = await getAssociatedTokenAddress(mint, treasury.publicKey);

  // Make sure the source ATA exists. `distribute` aborts before ever calling
  // this if it doesn't — but in dry-runs / tests we may need it.
  for (const plan of plans) {
    const destAta = await getAssociatedTokenAddress(mint, plan.recipient);
    // Does the recipient already have an ATA?
    let exists = false;
    try {
      await getAccount(connection, destAta);
      exists = true;
    } catch (err) {
      if (!(err instanceof TokenAccountNotFoundError)) throw err;
    }
    if (!exists) {
      instructions.push(
        createAssociatedTokenAccountInstruction(
          feePayer,
          destAta,
          plan.recipient,
          mint,
        ),
      );
    }
    instructions.push(
      createTransferInstruction(sourceAta, destAta, treasury.publicKey, plan.amount),
    );
  }

  const tx = new Transaction().add(...instructions);
  tx.feePayer = feePayer;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  return tx;
}

/**
 * Scale raw accrued base units into `$DOZZZE` base units when distributing
 * a fixed total pool. Each address gets `(accrued / totalAccrued) × pool`,
 * floored so we never over-spend. Returns per-address base-unit counts and
 * the residual (dust) that the caller may keep in the treasury.
 */
export function proportionalSplit(
  rows: readonly { walletAddress: string; amount: number }[],
  totalPool: bigint,
): { assignments: Array<{ walletAddress: string; amount: bigint }>; residual: bigint } {
  const totalAccrued = rows.reduce((acc, r) => acc + BigInt(r.amount), 0n);
  if (totalAccrued === 0n) {
    return { assignments: [], residual: totalPool };
  }
  const assignments = rows.map((r) => ({
    walletAddress: r.walletAddress,
    amount: (BigInt(r.amount) * totalPool) / totalAccrued,
  }));
  const distributed = assignments.reduce((acc, a) => acc + a.amount, 0n);
  return { assignments, residual: totalPool - distributed };
}

/**
 * Chunk a list of transfer plans so every chunk fits under Solana's tx
 * size budget. ~4 transfers per tx is conservative once ATA-creation
 * ixs are possible; we tune here rather than risking a failed broadcast.
 */
export function chunkPlans<T>(plans: readonly T[], chunkSize = 4): T[][] {
  if (chunkSize < 1) throw new Error('chunkSize must be >= 1');
  const out: T[][] = [];
  for (let i = 0; i < plans.length; i += chunkSize) {
    out.push(plans.slice(i, i + chunkSize));
  }
  return out;
}

/** Parse a Solana CLI-style keypair JSON file into a Keypair. */
export function loadKeypairFromJson(json: string): Keypair {
  const parsed = JSON.parse(json) as number[] | unknown;
  if (!Array.isArray(parsed) || parsed.length !== 64) {
    throw new Error(`expected 64-number array keypair, got ${Array.isArray(parsed) ? `length ${parsed.length}` : typeof parsed}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed as number[]));
}
