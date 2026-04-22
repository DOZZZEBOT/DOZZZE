// `dozzze ask` — quick consumer. Submits a prompt to the coordinator, waits
// for the result, prints it. Lets anyone with a coord URL be a consumer
// from the shell without writing code.
import { DozzzeClient, DozzzeClientError } from '@dozzze/client';
import { loadConfig } from '../config.js';
import * as log from '../logger.js';

export interface AskOptions {
  model?: string;
  timeout?: string;
  payout?: string;
  coord?: string;
  json?: boolean;
}

/** Submit `prompt` and print the Result when it arrives. */
export async function askCmd(prompt: string, opts: AskOptions): Promise<void> {
  if (!prompt || prompt.trim().length === 0) {
    throw new Error('prompt required. Usage: dozzze ask "<prompt>"');
  }

  const config = await loadConfig();
  const url = opts.coord ?? config.coordinator.url;
  const apiKey = process.env['DOZZZE_COORD_API_KEY'];
  const model = opts.model ?? 'llama3.2';
  const timeoutMs = Number.parseInt(opts.timeout ?? '120000', 10);
  const payout = Number.parseFloat(opts.payout ?? '0.01');

  const client = new DozzzeClient({
    url,
    ...(apiKey ? { apiKey } : {}),
  });

  if (!opts.json) {
    log.info(`submitting to ${url} model=${model}`);
  }
  try {
    const jobId = await client.submit({ model, prompt, payout });
    if (!opts.json) log.info(`job id: ${jobId}`);
    const result = await client.awaitResult(jobId, { timeoutMs, pollMs: 1_000 });
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      log.ok(
        `result (${result.tokensIn}+${result.tokensOut} tokens, ` +
          `${result.durationMs}ms, by ${result.nodeId})`,
      );
      process.stdout.write('\n' + result.output + '\n\n');
      if (result.settlementTx) {
        log.info(`settled on-chain: ${result.settlementTx}`);
      }
    }
  } catch (err) {
    if (err instanceof DozzzeClientError) {
      log.err(`coordinator error ${err.status}: ${err.message}`);
      process.exit(err.status === 408 ? 4 : 5);
    }
    throw err;
  }
}
