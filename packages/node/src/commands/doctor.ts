// `dozzze doctor` — environment health check. Exit code 0 if everything looks
// good, non-zero if something needs fixing. Helpful during install + first run.
import { loadConfig, configExists } from '../config.js';
import { detectAll } from '../detector.js';
import * as log from '../logger.js';
import { walletExists } from '../wallet.js';

/** Run a series of checks and print a pass/fail for each. Returns an exit code. */
export async function doctorCmd(): Promise<number> {
  log.banner(['', '  DOZZZE doctor', '']);
  let failures = 0;

  // 1. Node version
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  if (nodeMajor >= 20) {
    log.ok(`node.js: ${process.versions.node} (>= 20 OK)`);
  } else {
    log.err(`node.js: ${process.versions.node} — DOZZZE needs Node 20+`);
    failures += 1;
  }

  // 2. Config file
  if (configExists()) {
    try {
      const cfg = await loadConfig();
      log.ok(`config: valid (${cfg.nodeId})`);
    } catch (e) {
      log.err(`config: invalid — ${e instanceof Error ? e.message : String(e)}`);
      failures += 1;
    }
  } else {
    log.warn('config: not created yet (will be on first `dozzze start`)');
  }

  // 3. Wallet
  if (walletExists()) {
    log.ok('wallet: present');
  } else {
    log.warn('wallet: not created yet (run `dozzze wallet create`)');
  }

  // 4. Runtimes
  const runtimes = await detectAll();
  const anyUp = runtimes.some((r) => r.running);
  for (const r of runtimes) {
    if (r.running) {
      log.ok(`runtime ${r.name}: up @ ${r.url} (${r.models.length} models)`);
    } else {
      log.warn(`runtime ${r.name}: down @ ${r.url}${r.error ? ` — ${r.error}` : ''}`);
    }
  }
  if (!anyUp) {
    log.err('no local runtime is running. Start Ollama or LM Studio.');
    failures += 1;
  }

  // 5. Network egress (optional, informational).
  // Explicit controller + clearTimeout so Node's event loop shuts down cleanly
  // on Windows (AbortSignal.timeout leaks a handle under Node 24 + libuv).
  const rpcCtrl = new AbortController();
  const rpcTimer = setTimeout(() => rpcCtrl.abort(), 2000);
  try {
    const res = await fetch('https://api.devnet.solana.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: rpcCtrl.signal,
    });
    // Drain the body so fetch's underlying socket can close before process exit
    // (libuv asserts on Windows when an unread response stream is still open).
    await res.text().catch(() => '');
    if (res.ok) log.ok('solana devnet RPC: reachable');
    else log.warn(`solana devnet RPC: HTTP ${res.status}`);
  } catch {
    log.warn('solana devnet RPC: unreachable (this is fine for offline dev)');
  } finally {
    clearTimeout(rpcTimer);
  }

  log.banner([
    '',
    failures === 0 ? '  all checks passed.' : `  ${failures} check(s) failed.`,
    '',
  ]);
  return failures === 0 ? 0 : 1;
}
