#!/usr/bin/env node
// `dozzze-coord` — boots the HTTP coordinator on 127.0.0.1 by default.
// Bind to 0.0.0.0 only when you trust the network and understand the consequences.
import { serve } from '@hono/node-server';
import { Command } from 'commander';
import { createApp } from './server.js';

const VERSION = '0.2.0';

const program = new Command();

program
  .name('dozzze-coord')
  .description('DOZZZE coordinator — HTTP job broker.')
  .version(VERSION, '-v, --version')
  .option('-p, --port <n>', 'Port to listen on', '8787')
  .option('-h, --host <addr>', 'Bind host (default: 127.0.0.1)', '127.0.0.1')
  .action((opts: { port: string; host: string }) => {
    const port = Number.parseInt(opts.port, 10);
    if (!Number.isFinite(port) || port < 1 || port > 65535) {
      process.stderr.write(`invalid port: ${opts.port}\n`);
      process.exit(1);
    }
    if (opts.host === '0.0.0.0') {
      process.stderr.write(
        '⚠ binding to 0.0.0.0 — your queue is now internet-addressable.\n',
      );
    }
    const { app } = createApp();
    serve({ fetch: app.fetch, port, hostname: opts.host }, (info) => {
      process.stdout.write(
        `dozzze-coord listening on http://${info.address}:${info.port}\n` +
          `  POST /submit            — consumer enqueues a job\n` +
          `  GET  /poll/:nodeId      — node pulls the next job\n` +
          `  POST /report            — node reports a result\n` +
          `  GET  /result/:jobId     — consumer fetches a result\n` +
          `  GET  /health            — liveness + queue stats\n`,
      );
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`dozzze-coord: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
