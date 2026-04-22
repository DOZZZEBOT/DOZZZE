// Public exports for programmatic embedding of the coordinator.
export { createApp, type CoordinatorOptions } from './server.js';
export { createStore, type CoordinatorStore, type AccrualRow } from './queue.js';
export { createSqliteStore } from './store-sqlite.js';
export { bearerAuth, parseApiKeys, type AuthOptions } from './auth.js';
export {
  buildTransferTx,
  chunkPlans,
  loadKeypairFromJson,
  proportionalSplit,
  type SplTransferPlan,
} from './settlement-spl.js';
export { distribute, type DistributeOpts, type DistributeReport } from './commands/distribute.js';
