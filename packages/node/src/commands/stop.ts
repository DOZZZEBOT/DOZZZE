// `dozzze stop` — signals the running node via its pidfile.
import * as log from '../logger.js';
import { readPid, isAlive, sendStop, clearPid } from '../pid.js';

/** Stop the running node. No-op with a friendly message if nothing is running. */
export async function stopCmd(): Promise<void> {
  const pid = await readPid();
  if (pid === null) {
    log.info('no pidfile — nothing to stop.');
    return;
  }
  if (!isAlive(pid)) {
    log.warn(`pidfile points at ${pid}, but nothing is running. Cleaning up.`);
    await clearPid();
    return;
  }
  const ok = sendStop(pid);
  if (!ok) {
    log.err(`failed to send SIGTERM to ${pid}. Try stopping it manually.`);
    process.exit(1);
  }
  log.ok(`sent SIGTERM to ${pid}. Bye.`);
}
