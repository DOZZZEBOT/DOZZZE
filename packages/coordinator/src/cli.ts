#!/usr/bin/env node
// `dozzze-coord` — boots the HTTP coordinator on 127.0.0.1 by default.
// Bind to 0.0.0.0 only when you trust the network and understand the consequences.
import { serve } from '@hono/node-server';
import { Command } from 'commander';
import { createApp } from './server.js';
import { createStore, type CoordinatorStore } from './queue.js';
import { parseApiKeys } from './auth.js';

const VERSION = '0.3.0';

const program = new Command();

program
  .name('dozzze-coord')
  .description('DOZZZE coordinator — HTTP job broker.')
  .version(VERSION, '-v, --version')
  .option('-p, --port <n>', 'Port to listen on', '8787')
  .option('-h, --host <addr>', 'Bind host (default: 127.0.0.1)', '127.0.0.1')
  .option('--db <file>', 'SQLite database file (persists queue across restarts)')
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
          '⚠ binding to 0.0.0.0 — your queue is now internet-addressable. Set DOZZZE_COORD_API_KEYS.\n',
        );
      }

      // API keys come from env so they never show up in process listings.
      const apiKeys = parseApiKeys(process.env['DOZZZE_COORD_API_KEYS']);
      const dbFile = opts.db ?? process.env['DOZZZE_COORD_DB'];

      let store: CoordinatorStore;
      if (dbFile) {
        // Lazy import so environments without better-sqlite3 (alpine without
        // build tools, for instance) can still run in-memory.
        const mod = await import('./store-sqlite.js');
        store = mod.createSqliteStore(dbFile);
        process.stdout.write(`● persistent queue at ${dbFile}\n`);
      } else {
        store = createStore();
      }

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
            `  POST /report            — node reports a result\n` +
            `  GET  /result/:jobId     — consumer fetches a result\n` +
            `  GET  /health            — liveness + queue stats\n`,
        );
      });
    },
  );

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`dozzze-coord: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
