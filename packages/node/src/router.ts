// Wires the coordinator (mock or real HTTP) to the worker, optionally
// settling every Result on Solana devnet. This is the thing `dozzze start`
// actually runs.

import type { Config } from './config.js';
import type { Job, Result } from './protocol.js';
import { startMockCoordinator } from './coordinator-mock.js';
import { reportResult, startHttpCoordinator } from './coordinator-http.js';
import { runJob, type RuntimeKind } from './worker.js';
import { makeConnection, settleOnChain } from './settlement.js';
import type { Keypair } from '@solana/web3.js';
import * as log from './logger.js';

export interface RouterDeps {
  config: Config;
  nodeId: string;
  /** Called every time a Result is produced. MVP: no-op. v0.2: HTTP report. */
  onResult?: (r: Result) => void;
  /** If provided + settlement enabled, Results are memoed on-chain via this keypair. */
  settlementKeypair?: Keypair;
  /** Which local runtime to route jobs to. Defaults to Ollama. */
  runtime?: { kind: RuntimeKind; baseUrl: string };
  /** Node's Solana address — attached to every Result so the coord can credit earnings. */
  walletAddress?: string;
}

export interface RouterHandle {
  stop: () => void;
}

/** Boots the router loop. Returns a handle to stop it. */
export function startRouter(deps: RouterDeps): RouterHandle {
  const { config, nodeId, onResult, settlementKeypair } = deps;
  const mode = config.coordinator.mode;
  const runtime = deps.runtime ?? { kind: 'ollama' as const, baseUrl: config.ollamaUrl };

  const settlementConn = config.settlement.enabled
    ? makeConnection(config.settlement.cluster, config.settlement.rpcUrl)
    : null;

  log.info(`routing jobs to ${runtime.kind} @ ${runtime.baseUrl}`);

  const handleJob = async (job: Job): Promise<void> => {
    log.info(`job received ${job.id.slice(0, 8)} model=${job.model}`);
    try {
      let result = await runJob(job, {
        runtime: runtime.kind,
        baseUrl: runtime.baseUrl,
        nodeId,
      });
      if (deps.walletAddress) {
        result = { ...result, walletAddress: deps.walletAddress };
      }

      // Optional on-chain settlement. Best-effort — we still log the Result
      // and report it back to the coordinator even if settlement fails.
      if (settlementConn && settlementKeypair && config.settlement.enabled) {
        try {
          const tx = await settleOnChain(result, {
            connection: settlementConn,
            keypair: settlementKeypair,
          });
          result = { ...result, settlementTx: tx };
          log.ok(`settled on ${config.settlement.cluster}: ${tx.slice(0, 12)}…`);
        } catch (e) {
          log.warn(`settlement failed (result still logged): ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      log.ok(
        `inference done ${result.jobId.slice(0, 8)} ` +
          `tokens=${result.tokensIn}+${result.tokensOut} ` +
          `${result.durationMs}ms ` +
          `paid ${log.em(result.payout.toFixed(4))} $DOZZZE` +
          (result.settlementTx ? ` (tx ${result.settlementTx.slice(0, 8)}…)` : ' (mock)'),
      );

      if (mode === 'http') {
        try {
          await reportResult(config.coordinator.url, result);
        } catch (e) {
          log.warn(`coordinator report failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      onResult?.(result);
    } catch (e) {
      log.err(`job ${job.id.slice(0, 8)} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (mode === 'mock') {
    log.info(`mock coordinator: 1 job every ${(config.pollIntervalMs / 1000).toFixed(0)}s`);
    const stop = startMockCoordinator({
      intervalMs: config.pollIntervalMs,
      onJob: handleJob,
    });
    return { stop };
  }

  log.info(`http coordinator: polling ${config.coordinator.url} every ${(config.pollIntervalMs / 1000).toFixed(0)}s`);
  const stop = startHttpCoordinator({
    url: config.coordinator.url,
    nodeId,
    intervalMs: config.pollIntervalMs,
    onJob: handleJob,
    onError: (err) => log.warn(`coordinator poll: ${err.message}`),
  });
  return { stop };
}
