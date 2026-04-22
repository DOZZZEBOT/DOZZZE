#!/usr/bin/env node
// `dozzze` CLI entry point. Wires commander subcommands. Keep this file thin —
// each command's logic lives in its own module under `commands/`.

import { Command } from 'commander';
import { startCmd } from './commands/start.js';
import { stopCmd } from './commands/stop.js';
import { configCmd } from './commands/config.js';
import { walletCmd } from './commands/wallet.js';
import { statusCmd } from './commands/status.js';
import { doctorCmd } from './commands/doctor.js';

const VERSION = '0.2.0';

const program = new Command();

program
  .name('dozzze')
  .description('DOZZZE node — put your idle compute to work, earn $DOZZZE.')
  .version(VERSION, '-v, --version');

program
  .command('start')
  .description('Start the node. Detects local runtime and joins the (mocked) coordinator.')
  .option('--foreground', 'Run in the foreground rather than writing a pidfile.', false)
  .action(async (opts: { foreground: boolean }) => {
    await startCmd(opts);
  });

program
  .command('stop')
  .description('Stop a running node by sending SIGTERM to the pidfile PID.')
  .action(async () => {
    await stopCmd();
  });

program
  .command('status')
  .description('Print whether the node is running plus wallet/runtime state.')
  .action(async () => {
    await statusCmd();
  });

program
  .command('doctor')
  .description('Run an environment health check. Tells you exactly what is wrong.')
  .action(async () => {
    // Use exitCode rather than process.exit() so open fetch sockets drain
    // cleanly. On Node 24 + Windows, a hard exit while sockets are CLOSING
    // trips a libuv assertion.
    process.exitCode = await doctorCmd();
  });

program
  .command('config')
  .description('Read, set, or show the current ~/.dozzze/config.json.')
  .argument('[action]', 'show | get <key> | set <key> <value> | path', 'show')
  .argument('[key]', 'Key when using get/set')
  .argument('[value]', 'Value when using set')
  .action(async (action: string, key: string | undefined, value: string | undefined) => {
    await configCmd(action, key, value);
  });

program
  .command('wallet')
  .description('Manage the on-disk Solana keystore.')
  .argument('<action>', 'create | show | import | verify')
  .action(async (action: string) => {
    await walletCmd(action);
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`dozzze: ${msg}\n`);
  process.exit(1);
});
