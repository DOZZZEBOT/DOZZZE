#!/usr/bin/env node
// `dozzze-coord` — boots the HTTP coordinator or runs batch distribution.
import { serve } from '@hono/node-server';
import { Command } from 'commander';
import { createApp } from './server.js';
import { createStore, type CoordinatorStore } from './queue.js';
import { parseApiKeys } from './auth.js';
import { distribute } from './commands/distribute.js';

const VERSION = '0.4.0';

async function resolveStore(dbFile: string | undefined): Promise<CoordinatorStore> {
  if (!dbFile) return createStore();
  const mod = await import('./store-sqlite.js');
  return mod.createSqliteStore(dbFile);
}

const program = new Command();

program
  .name('dozzze-coord')
  .description('DOZZZE coordinator — HTTP job broker + SPL distribution.')
  .version(VERSION, '-v, --version');

program
  .command('serve', { isDefault: true })
  .description('Run the HTTP broker.')
  .option('-p, --port <n>', 'Port to listen on', '8787')
  .option('-h, --host <addr>', 'Bind host (default: 127.0.0.1)', '127.0.0.1')
  .option('--db <file>', 'SQLite database file (persists queue + ledger)')
  .option('--long-poll <ms>', 'Block /poll up to N ms when queue is empty', '0')
  .option('--rate-limit <n>', 'Requests per window per API key', '60')
  .option('--window <ms>', 'Rate limit window in ms', '60000')
  .action(
    async (opts: {
      port: string;
      host: string;
      db?: string;
      longPoll: string;
      rateLimit: string;
      window: string;
    }) => {
      const port = Number.parseInt(opts.port, 10);
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        process.stderr.write(`invalid port: ${opts.port}\n`);
        process.exit(1);
      }
      if (opts.host === '0.0.0.0') {
        process.stderr.write(
          '⚠ binding to 0.0.0.0 — queue is internet-addressable. Set DOZZZE_COORD_API_KEYS.\n',
        );
      }

      const apiKeys = parseApiKeys(process.env['DOZZZE_COORD_API_KEYS']);
      const dbFile = opts.db ?? process.env['DOZZZE_COORD_DB'];
      const store = await resolveStore(dbFile);
      if (dbFile) process.stdout.write(`● persistent queue + ledger at ${dbFile}\n`);

      const { app } = createApp({
        store,
        apiKeys,
        rateLimit: Number.parseInt(opts.rateLimit, 10),
        windowMs: Number.parseInt(opts.window, 10),
        longPollMs: Number.parseInt(opts.longPoll, 10),
      });

      serve({ fetch: app.fetch, port, hostname: opts.host }, (info) => {
        process.stdout.write(
          `dozzze-coord v${VERSION} listening on http://${info.address}:${info.port}\n` +
            (apiKeys.length > 0
              ? `● bearer auth ON (${apiKeys.length} key${apiKeys.length > 1 ? 's' : ''})\n`
              : `⚠ bearer auth OFF — set DOZZZE_COORD_API_KEYS before going public\n`) +
            `  POST /submit            — consumer enqueues a job\n` +
            `  GET  /poll/:nodeId      — node pulls the next job\n` +
            `  POST /report            — node reports a result (credits ledger)\n` +
            `  GET  /result/:jobId     — consumer fetches a result\n` +
            `  GET  /balance/:address  — node checks accrued vs paid\n` +
            `  GET  /balances          — operator view (auth-gated)\n` +
            `  GET  /health            — liveness + queue + ledger stats\n`,
        );
      });
    },
  );

program
  .command('distribute')
  .description('Pay every unpaid accrued row via SPL transfer from the treasury.')
  .requiredOption('--mint <address>', 'SPL token mint address ($DOZZZE CA)')
  .requiredOption('--treasury-keypair <file>', 'Solana CLI-format keypair JSON file')
  .option('--cluster <name>', 'devnet | testnet | mainnet-beta', 'mainnet-beta')
  .option('--rpc-url <url>', 'Override RPC URL for the cluster')
  .option('--db <file>', 'SQLite file holding the accrual ledger')
  .option(
    '--pool <amount>',
    'Distribute this many base units proportionally (default: 1:1 with accrued)',
  )
  .option('--chunk <n>', 'Transfers per transaction', '4')
  .option('--dry-run', 'Preview recipients + amounts; send nothing', false)
  .action(
    async (opts: {
      mint: string;
      treasuryKeypair: string;
      cluster: 'devnet' | 'testnet' | 'mainnet-beta';
      rpcUrl?: string;
      db?: string;
      pool?: string;
      chunk: string;
      dryRun: boolean;
    }) => {
      const dbFile = opts.db ?? process.env['DOZZZE_COORD_DB'];
      if (!dbFile) {
        process.stderr.write(
          '× distribute needs a persistent ledger. Set --db <file> or DOZZZE_COORD_DB.\n',
        );
        process.exit(1);
      }
      const store = await resolveStore(dbFile);
      try {
        const report = await distribute({
          store,
          mint: opts.mint,
          cluster: opts.cluster,
          ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
          treasuryKeypair: opts.treasuryKeypair,
          ...(opts.pool ? { pool: BigInt(opts.pool) } : {}),
          dryRun: opts.dryRun,
          chunkSize: Number.parseInt(opts.chunk, 10),
        });
        if (report.failed.length > 0) process.exit(2);
      } finally {
        store.close?.();
      }
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`dozzze-coord: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
