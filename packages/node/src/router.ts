// Wires the coordinator (mock or real) to the worker. This is the thing
// `dozzze start` actually runs.

import type { Config } from './config.js';
import type { Job, Result } from './protocol.js';
import { startMockCoordinator } from './coordinator-mock.js';
import { runJob } from './worker.js';
import * as log from './logger.js';

export interface RouterDeps {
  config: Config;
  nodeId: string;
  /** Called every time a Result is produced. MVP: just logs. v0.2: settle on-chain. */
  onResult?: (r: Result) => void;
}

export interface RouterHandle {
  stop: () => void;
}

/** Boots the router loop. Returns a handle to stop it. */
export function startRouter(deps: RouterDeps): RouterHandle {
  const { config, nodeId, onResult } = deps;

  const handleJob = async (job: Job): Promise<void> => {
    log.info(`job received ${job.id.slice(0, 8)} model=${job.model}`);
    try {
      const result = await runJob(job, {
        ollamaUrl: config.ollamaUrl,
        nodeId,
      });
      log.ok(
        `inference done ${result.jobId.slice(0, 8)} ` +
          `tokens=${result.tokensIn}+${result.tokensOut} ` +
          `${result.durationMs}ms ` +
          `paid ${log.em(result.payout.toFixed(4))} $DOZZZE (mock)`,
      );
      onResult?.(result);
    } catch (e) {
      log.err(`job ${job.id.slice(0, 8)} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  if (config.coordinator.mode === 'mock') {
    log.info(`mock coordinator: 1 job every ${(config.pollIntervalMs / 1000).toFixed(0)}s`);
    const stop = startMockCoordinator({
      intervalMs: config.pollIntervalMs,
      onJob: handleJob,
    });
    return { stop };
  }

  // Real coordinator is a v0.2 concern — surface a clear error so nobody trips
  // over it thinking it works.
  throw new Error(
    'Coordinator mode "http" is not implemented yet. Set coordinator.mode="mock" in config.json.',
  );
}
