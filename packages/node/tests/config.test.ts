import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ConfigSchema,
  configExists,
  defaultConfig,
  loadConfig,
  patchConfig,
  saveConfig,
} from '../src/config.js';

describe('config', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'dozzze-config-'));
    process.env['DOZZZE_HOME'] = home;
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
    delete process.env['DOZZZE_HOME'];
  });

  it('default config parses', () => {
    const cfg = defaultConfig();
    expect(cfg.nodeId).toMatch(/^NODE #\d{4}$/);
    expect(cfg.cluster).toBe('devnet');
    expect(cfg.pollIntervalMs).toBeGreaterThan(0);
  });

  it('saveConfig then loadConfig round-trips', async () => {
    const cfg = { ...defaultConfig(), nodeId: 'NODE #4242' };
    await saveConfig(cfg);
    expect(configExists()).toBe(true);
    const loaded = await loadConfig();
    expect(loaded.nodeId).toBe('NODE #4242');
  });

  it('loadConfig returns defaults when file missing', async () => {
    const loaded = await loadConfig();
    expect(loaded.nodeId).toMatch(/^NODE #\d{4}$/);
  });

  it('patchConfig merges on top of current', async () => {
    await saveConfig(defaultConfig());
    const updated = await patchConfig({ nodeId: 'NODE #0001', cluster: 'mainnet-beta' });
    expect(updated.nodeId).toBe('NODE #0001');
    expect(updated.cluster).toBe('mainnet-beta');
    const re = await loadConfig();
    expect(re.nodeId).toBe('NODE #0001');
  });

  it('rejects invalid nodeId pattern', () => {
    const r = ConfigSchema.safeParse({ nodeId: 'bogus' });
    expect(r.success).toBe(false);
  });

  it('rejects unknown cluster', () => {
    const r = ConfigSchema.safeParse({ cluster: 'sepolia' });
    expect(r.success).toBe(false);
  });

  it('coordinator defaults to mock mode with a localhost URL', () => {
    const cfg = defaultConfig();
    expect(cfg.coordinator.mode).toBe('mock');
    expect(cfg.coordinator.url).toBe('http://127.0.0.1:8787');
  });

  it('settlement is disabled by default on devnet', () => {
    const cfg = defaultConfig();
    expect(cfg.settlement.enabled).toBe(false);
    expect(cfg.settlement.cluster).toBe('devnet');
  });

  it('accepts settlement + coordinator overrides via patchConfig', async () => {
    await saveConfig(defaultConfig());
    const updated = await patchConfig({
      coordinator: { mode: 'http', url: 'https://coord.example.com' },
      settlement: { enabled: true, cluster: 'devnet' },
    });
    expect(updated.coordinator.mode).toBe('http');
    expect(updated.settlement.enabled).toBe(true);
  });
});
