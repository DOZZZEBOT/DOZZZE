// `dozzze wallet` — create / show / import / verify the local keystore.
import * as log from '../logger.js';
import {
  createAndSaveWallet,
  peekWallet,
  readKeystore,
  unlockWallet,
  walletExists,
  writeKeystore,
  wrapKeystore,
  encryptSecret,
  importFromBase58Secret,
} from '../wallet.js';
import { ask, askPassword, confirm } from '../prompt.js';
import { keystorePath } from '../paths.js';

/** Entry point for the wallet subcommand. */
export async function walletCmd(action: string): Promise<void> {
  switch (action) {
    case 'create':
      return createWalletFlow();
    case 'show':
      return showWalletFlow();
    case 'import':
      return importWalletFlow();
    case 'verify':
      return verifyWalletFlow();
    default:
      throw new Error(`unknown action: ${action}. Try create|show|import|verify.`);
  }
}

async function createWalletFlow(): Promise<void> {
  if (walletExists()) {
    log.warn(`a keystore already exists at ${keystorePath()}`);
    const go = await confirm('Overwrite it? This cannot be undone.');
    if (!go) {
      log.info('leaving existing wallet alone.');
      return;
    }
  }

  log.info('Choose a password for your new wallet. Minimum 8 chars.');
  log.warn('If you forget this password, the keystore is useless. Write it down.');
  const pw1 = await askPassword('new password: ');
  const pw2 = await askPassword('confirm password: ');
  if (pw1 !== pw2) {
    throw new Error('passwords do not match');
  }
  if (pw1.length < 8) {
    throw new Error('password must be at least 8 characters');
  }

  const created = await createAndSaveWallet(pw1);
  log.ok(`wallet created. address: ${log.em(created.info.address)}`);
  log.ok(`keystore saved to ${created.path}`);
  log.banner(['', '  RECOVERY MNEMONIC (write this down, offline, now)', '']);
  process.stdout.write(`  ${created.mnemonic}\n\n`);
  log.warn('the mnemonic will NOT be shown again. DOZZZE stores only the encrypted keystore.');
}

async function showWalletFlow(): Promise<void> {
  if (!walletExists()) {
    log.err('no wallet yet. Run `dozzze wallet create`.');
    process.exit(2);
  }
  const info = await peekWallet();
  if (!info) return;
  log.info(`address: ${log.em(info.address)}`);
  log.info(`created: ${new Date(info.createdAt).toISOString()}`);
  log.info(`path:    ${keystorePath()}`);
}

async function importWalletFlow(): Promise<void> {
  if (walletExists()) {
    const go = await confirm(`wallet already exists at ${keystorePath()}. Overwrite?`);
    if (!go) return;
  }
  const secret = await ask('paste base58-encoded 64-byte secret: ');
  const keypair = importFromBase58Secret(secret.trim());
  const pw1 = await askPassword('new password: ');
  const pw2 = await askPassword('confirm password: ');
  if (pw1 !== pw2) throw new Error('passwords do not match');
  if (pw1.length < 8) throw new Error('password must be at least 8 characters');
  const enc = await encryptSecret(keypair.secretKey, pw1);
  const ks = wrapKeystore(keypair.publicKey.toBase58(), enc);
  await writeKeystore(ks);
  log.ok(`imported wallet ${log.em(keypair.publicKey.toBase58())}`);
}

async function verifyWalletFlow(): Promise<void> {
  if (!walletExists()) {
    log.err('no wallet to verify. Run `dozzze wallet create`.');
    process.exit(2);
  }
  const ks = await readKeystore();
  log.info(`address on file: ${log.em(ks.address)}`);
  const pw = await askPassword('password: ');
  try {
    const kp = await unlockWallet(pw);
    if (kp.publicKey.toBase58() !== ks.address) {
      log.err('unlock succeeded but address mismatch — keystore may be corrupted.');
      process.exit(3);
    }
    log.ok('wallet unlocks. Password is correct.');
  } catch (e) {
    log.err(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}
