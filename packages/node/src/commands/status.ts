// `dozzze status` — print node health without requiring the node to be running.
import { loadConfig, configExists } from '../config.js';
import { detectAll } from '../detector.js';
import * as log from '../logger.js';
import { peekWallet, walletExists } from '../wallet.js';
import { readPid, isAlive } from '../pid.js';

/** Print a multi-line status report. Always exits 0. */
export async function statusCmd(): Promise<void> {
  log.banner(['', '  DOZZZE status', '']);

  const pid = await readPid();
  if (pid === null) {
    log.info('node: not running (no pidfile)');
  } else if (isAlive(pid)) {
    log.ok(`node: running, pid ${pid}`);
  } else {
    log.warn(`node: stale pidfile (${pid}); no process`);
  }

  if (configExists()) {
    const config = await loadConfig();
    log.info(`config: ${log.em(config.nodeId)} / ${config.cluster}`);
  } else {
    log.warn('config: not created yet — run `dozzze start` once to bootstrap.');
  }

  if (walletExists()) {
    const w = await peekWallet();
    log.info(`wallet: ${log.em(w?.address ?? 'unknown')}`);
  } else {
    log.warn('wallet: none — run `dozzze wallet create`.');
  }

  const runtimes = await detectAll().catch(() => []);
  for (const r of runtimes) {
    if (r.running) {
      log.ok(`runtime ${r.name}: up @ ${r.url} (${r.models.length} models)`);
    } else {
      log.warn(`runtime ${r.name}: down @ ${r.url}${r.error ? ` — ${r.error}` : ''}`);
    }
  }
}
