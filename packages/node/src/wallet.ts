// Solana keypair management with a scrypt + AES-256-GCM keystore on disk.
//
// Threat model: someone who gets read access to `~/.dozzze/keystore.json` but
// not the passphrase should not be able to recover the private key. Password
// cracking resistance comes from scrypt's memory-hardness (N=2^15, r=8, p=1).
//
// NOT a substitute for a hardware wallet. Real value → hardware. MVP / devnet → this.

import { randomBytes, scrypt, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import bs58 from 'bs58';
import { z } from 'zod';
import { ensureHome, keystorePath } from './paths.js';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem?: number },
) => Promise<Buffer>;

const SCRYPT_N = 1 << 15; // 32768 — CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32; // AES-256
const IV_LEN = 12; // GCM recommended
const SALT_LEN = 16;

export const KeystoreSchema = z.object({
  version: z.literal(1),
  kind: z.literal('scrypt-aes-256-gcm'),
  address: z.string().min(32),
  kdf: z.object({
    name: z.literal('scrypt'),
    N: z.number().int().positive(),
    r: z.number().int().positive(),
    p: z.number().int().positive(),
    salt: z.string().min(1),
  }),
  cipher: z.object({
    name: z.literal('aes-256-gcm'),
    iv: z.string().min(1),
    ciphertext: z.string().min(1),
    authTag: z.string().min(1),
  }),
  createdAt: z.number().int().positive(),
});
export type Keystore = z.infer<typeof KeystoreSchema>;

/** Human-friendly wallet summary, safe to print. Never contains the private key. */
export interface WalletInfo {
  address: string;
  createdAt: number;
}

function b64(buf: Buffer): string {
  return buf.toString('base64');
}
function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64');
}

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  // maxmem must exceed 128*N*r; set generously for scrypt with N=2^15.
  return scryptAsync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

/** Encrypts a 64-byte Solana secret key with the given passphrase. */
export async function encryptSecret(secret: Uint8Array, password: string): Promise<Keystore['cipher'] & { kdf: Keystore['kdf'] }> {
  if (secret.length !== 64) {
    throw new Error(`expected 64-byte Solana secret, got ${secret.length}`);
  }
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(Buffer.from(secret)), cipher.final()]);
  const authTag = cipher.getAuthTag();
  key.fill(0); // best-effort zeroization
  return {
    name: 'aes-256-gcm',
    iv: b64(iv),
    ciphertext: b64(ct),
    authTag: b64(authTag),
    kdf: {
      name: 'scrypt',
      N: SCRYPT_N,
      r: SCRYPT_R,
      p: SCRYPT_P,
      salt: b64(salt),
    },
  };
}

/** Decrypts a keystore and returns the raw 64-byte secret key. */
export async function decryptKeystore(keystore: Keystore, password: string): Promise<Uint8Array> {
  const salt = unb64(keystore.kdf.salt);
  const iv = unb64(keystore.cipher.iv);
  const ct = unb64(keystore.cipher.ciphertext);
  const tag = unb64(keystore.cipher.authTag);
  const key = await deriveKey(password, salt);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    key.fill(0);
    return new Uint8Array(pt);
  } catch {
    key.fill(0);
    throw new Error('Keystore decryption failed — wrong password or tampered file.');
  }
}

/** Builds a keystore envelope around an encrypted secret. */
export function wrapKeystore(
  address: string,
  enc: Awaited<ReturnType<typeof encryptSecret>>,
): Keystore {
  return {
    version: 1,
    kind: 'scrypt-aes-256-gcm',
    address,
    kdf: enc.kdf,
    cipher: {
      name: 'aes-256-gcm',
      iv: enc.iv,
      ciphertext: enc.ciphertext,
      authTag: enc.authTag,
    },
    createdAt: Date.now(),
  };
}

/** Returns true when a keystore file is present on disk. */
export function walletExists(): boolean {
  return existsSync(keystorePath());
}

/** Reads the keystore from disk without decrypting it. */
export async function readKeystore(): Promise<Keystore> {
  const raw = await readFile(keystorePath(), 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return KeystoreSchema.parse(parsed);
}

/** Writes a keystore to disk with tight permissions. */
export async function writeKeystore(keystore: Keystore): Promise<string> {
  await ensureHome();
  const path = keystorePath();
  await writeFile(path, JSON.stringify(keystore, null, 2) + '\n', 'utf8');
  // On POSIX, tighten to user-read/write. No-op on Windows.
  if (process.platform !== 'win32') {
    try {
      await chmod(path, 0o600);
    } catch {
      /* best effort */
    }
  }
  return path;
}

/** Creates a new random Solana keypair + BIP-39 mnemonic. Returns both. */
export function generateKeypair(): { keypair: Keypair; mnemonic: string } {
  const mnemonic = bip39.generateMnemonic(128);
  // We don't derive from mnemonic for MVP — we generate a random keypair and
  // surface a mnemonic ONLY as a user-facing recovery note. v0.2 will switch
  // to proper SLIP-10 ed25519 derivation.
  const keypair = Keypair.generate();
  return { keypair, mnemonic };
}

/** Imports a keypair from a 64-byte secret provided as base58. */
export function importFromBase58Secret(secretBase58: string): Keypair {
  const raw = bs58.decode(secretBase58);
  if (raw.length !== 64) {
    throw new Error(`Expected 64-byte secret, got ${raw.length} bytes`);
  }
  return Keypair.fromSecretKey(raw);
}

/** Creates a new wallet, encrypts it with the password, writes it to disk. */
export async function createAndSaveWallet(password: string): Promise<{
  info: WalletInfo;
  mnemonic: string;
  path: string;
}> {
  if (password.length < 8) {
    throw new Error('Wallet password must be at least 8 characters.');
  }
  const { keypair, mnemonic } = generateKeypair();
  const enc = await encryptSecret(keypair.secretKey, password);
  const keystore = wrapKeystore(keypair.publicKey.toBase58(), enc);
  const path = await writeKeystore(keystore);
  return {
    info: { address: keystore.address, createdAt: keystore.createdAt },
    mnemonic,
    path,
  };
}

/** Loads and decrypts the on-disk wallet. */
export async function unlockWallet(password: string): Promise<Keypair> {
  const keystore = await readKeystore();
  const secret = await decryptKeystore(keystore, password);
  return Keypair.fromSecretKey(secret);
}

/** Returns the public wallet info without decrypting. */
export async function peekWallet(): Promise<WalletInfo | null> {
  if (!walletExists()) return null;
  const keystore = await readKeystore();
  return { address: keystore.address, createdAt: keystore.createdAt };
}

/**
 * Compares two strings in constant time. Exported for tests and for CLI password
 * confirmation prompts where a short-circuit comparison would leak length info.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
