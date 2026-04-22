// `dozzze start` — boot the router loop after sanity checks.
import { loadConfig, configExists, saveConfig, defaultConfig } from '../config.js';
import { detectAll } from '../detector.js';
import * as log from '../logger.js';
import { walletExists, peekWallet } from '../wallet.js';
import { startRouter } from '../router.js';
import { writePid, clearPid } from '../pid.js';

/** Start the node. Creates a default config on first run. */
export async function startCmd(opts: { foreground: boolean }): Promise<void> {
  log.banner([
    '',
    '  D O Z Z Z E  ::  NODE  ::  v0.1.0',
    '  Idle compute, awake.',
    '',
  ]);

  // First-run bootstrap: create config if missing.
  if (!configExists()) {
    const cfg = defaultConfig();
    await saveConfig(cfg);
    log.ok(`wrote default config to ~/.dozzze/config.json`);
  }

  const config = await loadConfig();
  log.info(`nodeId: ${log.em(config.nodeId)}  cluster: ${config.cluster}`);

  // Wallet is required unless the user disabled it. Be loud about it.
  if (config.requireWallet) {
    if (!walletExists()) {
      log.err('no wallet found. Run `dozzze wallet create` first.');
      process.exit(2);
    }
    const info = await peekWallet();
    log.info(`wallet: ${log.em(info?.address ?? '(locked)')}`);
  } else {
    log.warn('wallet check disabled via config. Payouts will be mocked only.');
  }

  // Runtime detection — we need at least one to do work.
  const runtimes = await detectAll({
    ollamaUrl: config.ollamaUrl,
    lmStudioUrl: config.lmStudioUrl,
  });
  const running = runtimes.filter((r) => r.running);
  if (running.length === 0) {
    log.err('no local runtime detected.');
    log.err('start Ollama with `ollama serve`, or launch LM Studio, then retry.');
    process.exit(3);
  }
  for (const r of running) {
    log.ok(`runtime ${r.name} up @ ${r.url} (${r.models.length} models)`);
  }

  if (!opts.foreground) {
    await writePid();
  }

  const handle = startRouter({ config, nodeId: config.nodeId });

  const shutdown = (signal: string): void => {
    log.warn(`received ${signal} — shutting down.`);
    handle.stop();
    void clearPid().finally(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.ok('node is live. Ctrl-C to stop.');
  // Keep the event loop alive by never resolving.
  await new Promise<void>(() => {
    /* hang forever */
  });
}
