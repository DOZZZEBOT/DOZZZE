import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  constantTimeEqual,
  createAndSaveWallet,
  decryptKeystore,
  encryptSecret,
  generateKeypair,
  importFromBase58Secret,
  peekWallet,
  readKeystore,
  unlockWallet,
  walletExists,
  wrapKeystore,
} from '../src/wallet.js';
import bs58 from 'bs58';

describe('wallet', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dozzze-wallet-'));
    process.env['DOZZZE_HOME'] = home;
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    delete process.env['DOZZZE_HOME'];
  });

  it('encrypt → decrypt round-trips', async () => {
    const { keypair } = generateKeypair();
    const enc = await encryptSecret(keypair.secretKey, 'password123');
    const keystore = wrapKeystore(keypair.publicKey.toBase58(), enc);
    const secret = await decryptKeystore(keystore, 'password123');
    expect(Buffer.from(secret).equals(Buffer.from(keypair.secretKey))).toBe(true);
  });

  it('wrong password throws', async () => {
    const { keypair } = generateKeypair();
    const enc = await encryptSecret(keypair.secretKey, 'correct-horse');
    const keystore = wrapKeystore(keypair.publicKey.toBase58(), enc);
    await expect(decryptKeystore(keystore, 'wrong-password')).rejects.toThrow();
  });

  it('createAndSaveWallet writes a valid keystore', async () => {
    const r = await createAndSaveWallet('hunter2hunter2');
    expect(walletExists()).toBe(true);
    const peek = await peekWallet();
    expect(peek?.address).toBe(r.info.address);

    const ks = await readKeystore();
    expect(ks.kind).toBe('scrypt-aes-256-gcm');
    expect(ks.address).toBe(r.info.address);
  });

  it('unlockWallet returns the same keypair as on creation', async () => {
    const r = await createAndSaveWallet('hunter2hunter2');
    const kp = await unlockWallet('hunter2hunter2');
    expect(kp.publicKey.toBase58()).toBe(r.info.address);
  });

  it('rejects short passwords on createAndSaveWallet', async () => {
    await expect(createAndSaveWallet('short')).rejects.toThrow(/at least 8/);
  });

  it('importFromBase58Secret parses a 64-byte secret', () => {
    const { keypair } = generateKeypair();
    const encoded = bs58.encode(keypair.secretKey);
    const imported = importFromBase58Secret(encoded);
    expect(imported.publicKey.toBase58()).toBe(keypair.publicKey.toBase58());
  });

  it('importFromBase58Secret rejects malformed length', () => {
    const tooShort = bs58.encode(Buffer.alloc(33));
    expect(() => importFromBase58Secret(tooShort)).toThrow();
  });

  it('constantTimeEqual works like string equality', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'ab')).toBe(false);
  });

  it('keystore envelope has 16-byte salt and 12-byte IV', async () => {
    const r = await createAndSaveWallet('hunter2hunter2');
    const ks = await readKeystore();
    expect(Buffer.from(ks.kdf.salt, 'base64').length).toBe(16);
    expect(Buffer.from(ks.cipher.iv, 'base64').length).toBe(12);
    expect(ks.address).toBe(r.info.address);
  });
});
