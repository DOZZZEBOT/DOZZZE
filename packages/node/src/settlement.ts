// Optional Solana devnet settlement — signs a memo transaction that records
// (jobId, nodeId, payout) on-chain. Off by default in v0.2; explicit opt-in
// via config.settlement.enabled + a funded wallet on devnet.
//
// Memo program (v2): MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
// Docs: https://spl.solana.com/memo

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { Result } from '@dozzze/sdk';

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

export type Cluster = 'devnet' | 'testnet' | 'mainnet-beta';

const RPC_URL: Record<Cluster, string> = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

/**
 * Resolve a cluster name to the canonical RPC URL, or return a custom URL
 * unchanged when one is provided.
 */
export function rpcUrlFor(cluster: Cluster, override?: string): string {
  if (override && override.length > 0) return override;
  return RPC_URL[cluster];
}

/** Builds the memo payload inscribed on-chain. Kept compact to minimize fees. */
export function buildMemoPayload(result: Result): string {
  const trimmed = {
    j: result.jobId,
    n: result.nodeId,
    t: result.tokensIn + result.tokensOut,
    p: Number(result.payout.toFixed(6)),
    c: result.completedAt,
  };
  return `dozzze:v1:${JSON.stringify(trimmed)}`;
}

export interface SettlementDeps {
  connection: Connection;
  keypair: Keypair;
}

/**
 * Sign + send a memo transaction for the given Result. Returns the tx signature.
 * Throws on wallet underfunding, RPC failure, or rejected signature — the caller
 * should treat settlement as best-effort and log the Result regardless.
 */
export async function settleOnChain(result: Result, deps: SettlementDeps): Promise<string> {
  const { connection, keypair } = deps;
  const memo = buildMemoPayload(result);
  const ix = new TransactionInstruction({
    keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(memo, 'utf8'),
  });
  // A 0-lamport self-transfer is not strictly needed for a memo, but it makes
  // the tx show up on explorers that filter SystemProgram traffic. Kept minimal.
  const dust = SystemProgram.transfer({
    fromPubkey: keypair.publicKey,
    toPubkey: keypair.publicKey,
    lamports: 0,
  });
  const tx = new Transaction().add(ix).add(dust);
  tx.feePayer = keypair.publicKey;
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.sign(keypair);
  const raw = tx.serialize();
  const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return signature;
}

/** Build a Connection bound to the chosen cluster. */
export function makeConnection(cluster: Cluster, rpcOverride?: string): Connection {
  return new Connection(rpcUrlFor(cluster, rpcOverride), 'confirmed');
}
