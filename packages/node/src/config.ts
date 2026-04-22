// Reads/writes `~/.dozzze/config.json`. Schema-validated with zod.
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { z } from 'zod';
import { configPath, ensureHome } from './paths.js';

export const ConfigSchema = z.object({
  /** Human-readable node identity shown in logs. */
  nodeId: z
    .string()
    .regex(/^NODE #\d{4}$/)
    .default('NODE #0069'),
  /** Solana cluster this node settles against. MVP: devnet. */
  cluster: z.enum(['devnet', 'testnet', 'mainnet-beta']).default('devnet'),
  /** Default Ollama endpoint. Users rarely need to override. */
  ollamaUrl: z.string().url().default('http://127.0.0.1:11434'),
  /** Default LM Studio endpoint. */
  lmStudioUrl: z.string().url().default('http://127.0.0.1:1234'),
  /** The mock coordinator polling interval, in ms. */
  pollIntervalMs: z.number().int().positive().default(30_000),
  /** Hard daily ceiling on API spend in USD. MVP: unused by mock worker. */
  dailyBudgetUsd: z.number().nonnegative().default(0),
  /** Whether to accept jobs when no wallet exists yet. MVP logs payouts; no on-chain. */
  requireWallet: z.boolean().default(true),
  /** Where the coordinator lives. `mock` fires synthetic jobs in-process; `http`
   *  polls a real coordinator URL (@dozzze/coordinator or compatible). */
  coordinator: z
    .object({
      mode: z.enum(['mock', 'http']).default('mock'),
      url: z.string().url().default('http://127.0.0.1:8787'),
    })
    .default({ mode: 'mock', url: 'http://127.0.0.1:8787' }),
  /** Optional Solana devnet settlement: sign a memo tx for every Result. */
  settlement: z
    .object({
      enabled: z.boolean().default(false),
      cluster: z.enum(['devnet', 'testnet', 'mainnet-beta']).default('devnet'),
      /** RPC URL override. Defaults to the canonical public RPC for `cluster`. */
      rpcUrl: z.string().url().optional(),
    })
    .default({ enabled: false, cluster: 'devnet' }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** Returns the default config. */
export function defaultConfig(): Config {
  return ConfigSchema.parse({});
}

/** Loads the config from disk. Falls back to defaults if the file is missing. */
export async function loadConfig(): Promise<Config> {
  const path = configPath();
  if (!existsSync(path)) return defaultConfig();
  const raw = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return ConfigSchema.parse(parsed);
}

/** Persists the given config to disk, creating `~/.dozzze/` if needed. */
export async function saveConfig(config: Config): Promise<string> {
  await ensureHome();
  const path = configPath();
  const validated = ConfigSchema.parse(config);
  await writeFile(path, JSON.stringify(validated, null, 2) + '\n', 'utf8');
  return path;
}

/** Returns true if a config file exists on disk. */
export function configExists(): boolean {
  return existsSync(configPath());
}

/**
 * Applies a partial patch to the on-disk config and returns the merged result.
 * Creates the config from defaults if it does not exist yet.
 */
export async function patchConfig(patch: Partial<Config>): Promise<Config> {
  const current = await loadConfig();
  const next = ConfigSchema.parse({ ...current, ...patch });
  await saveConfig(next);
  return next;
}
