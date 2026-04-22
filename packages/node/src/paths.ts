// Resolves the on-disk locations DOZZZE uses for config, keystore, and pidfile.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';

const ROOT_ENV = 'DOZZZE_HOME';

/** Returns the DOZZZE data directory, honoring the `DOZZZE_HOME` override. */
export function dozzzeHome(): string {
  const override = process.env[ROOT_ENV];
  if (override && override.trim().length > 0) return override;
  return join(homedir(), '.dozzze');
}

/** Path to the main config file. */
export function configPath(): string {
  return join(dozzzeHome(), 'config.json');
}

/** Path to the encrypted keystore file. */
export function keystorePath(): string {
  return join(dozzzeHome(), 'keystore.json');
}

/** Path to the pidfile used by `dozzze start` / `dozzze stop`. */
export function pidPath(): string {
  return join(dozzzeHome(), 'dozzze.pid');
}

/** Path to the rolling log file. */
export function logPath(): string {
  return join(dozzzeHome(), 'dozzze.log');
}

/** Ensures the DOZZZE home directory exists. Idempotent. */
export async function ensureHome(): Promise<string> {
  const home = dozzzeHome();
  await mkdir(home, { recursive: true });
  return home;
}
