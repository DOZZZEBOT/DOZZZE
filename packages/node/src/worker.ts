// Runs an inference job against a local runtime and returns a Result.
// Supports both Ollama (`/api/generate`) and LM Studio (`/v1/completions`,
// OpenAI-compatible). The runtime is picked by the caller; the worker itself
// is a pure function of (job, runtime) → Result.

import { z } from 'zod';
import type { Job, Result } from './protocol.js';
import { PROTOCOL_VERSION } from './protocol.js';

const OllamaGenerateResponseSchema = z.object({
  response: z.string(),
  done: z.boolean().optional(),
  prompt_eval_count: z.number().int().nonnegative().optional(),
  eval_count: z.number().int().nonnegative().optional(),
  total_duration: z.number().nonnegative().optional(),
});

const LmStudioCompletionSchema = z.object({
  choices: z
    .array(
      z.object({
        text: z.string().optional(),
        message: z.object({ content: z.string() }).optional(),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

export type RuntimeKind = 'ollama' | 'lm-studio';

export interface WorkerDeps {
  runtime: RuntimeKind;
  baseUrl: string;
  nodeId: string;
  /** Mocked payout formula. Returns $DOZZZE to credit for a given Result. */
  priceFn?: (tokensIn: number, tokensOut: number) => number;
}

function defaultPrice(tokensIn: number, tokensOut: number): number {
  // Mock: 1 $DOZZZE per 1K tokens in+out.
  return (tokensIn + tokensOut) / 1000;
}

/**
 * Runs a single Job against the configured runtime. Returns a Result on
 * success. Throws a descriptive Error on non-2xx or malformed responses.
 *
 * Backwards compatibility: callers that pass `ollamaUrl` still work — it is
 * treated as an Ollama runtime.
 */
export async function runJob(
  job: Job,
  deps: WorkerDeps | { ollamaUrl: string; nodeId: string; priceFn?: WorkerDeps['priceFn'] },
): Promise<Result> {
  const normalized: WorkerDeps =
    'runtime' in deps
      ? deps
      : {
          runtime: 'ollama',
          baseUrl: deps.ollamaUrl,
          nodeId: deps.nodeId,
          ...(deps.priceFn ? { priceFn: deps.priceFn } : {}),
        };

  if (normalized.runtime === 'lm-studio') {
    return runJobLmStudio(job, normalized);
  }
  return runJobOllama(job, normalized);
}

async function runJobOllama(job: Job, deps: WorkerDeps): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch(`${deps.baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: job.model,
      prompt: job.prompt,
      stream: false,
      options: {
        num_predict: job.maxTokens,
        temperature: job.temperature,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama /api/generate failed: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const raw: unknown = await res.json();
  const parsed = OllamaGenerateResponseSchema.parse(raw);

  const durationMs = Date.now() - t0;
  const tokensIn = parsed.prompt_eval_count ?? estimateTokens(job.prompt);
  const tokensOut = parsed.eval_count ?? estimateTokens(parsed.response);
  const priceFn = deps.priceFn ?? defaultPrice;

  return {
    jobId: job.id,
    protocolVersion: PROTOCOL_VERSION,
    nodeId: deps.nodeId,
    output: parsed.response,
    tokensIn,
    tokensOut,
    durationMs,
    payout: priceFn(tokensIn, tokensOut),
    completedAt: Date.now(),
  };
}

async function runJobLmStudio(job: Job, deps: WorkerDeps): Promise<Result> {
  const t0 = Date.now();
  // LM Studio ships an OpenAI-compatible server. We use /v1/chat/completions
  // for chat jobs and /v1/completions for plain completion jobs.
  const isChat = job.kind === 'chat';
  const endpoint = isChat ? '/v1/chat/completions' : '/v1/completions';
  const body = isChat
    ? {
        model: job.model,
        messages: [{ role: 'user', content: job.prompt }],
        max_tokens: job.maxTokens,
        temperature: job.temperature,
      }
    : {
        model: job.model,
        prompt: job.prompt,
        max_tokens: job.maxTokens,
        temperature: job.temperature,
      };

  const res = await fetch(`${deps.baseUrl}${endpoint}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`LM Studio ${endpoint} failed: HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  const parsed = LmStudioCompletionSchema.parse(await res.json());
  const choice = parsed.choices[0];
  const output = choice?.message?.content ?? choice?.text ?? '';
  const durationMs = Date.now() - t0;
  const tokensIn = parsed.usage?.prompt_tokens ?? estimateTokens(job.prompt);
  const tokensOut = parsed.usage?.completion_tokens ?? estimateTokens(output);
  const priceFn = deps.priceFn ?? defaultPrice;

  return {
    jobId: job.id,
    protocolVersion: PROTOCOL_VERSION,
    nodeId: deps.nodeId,
    output,
    tokensIn,
    tokensOut,
    durationMs,
    payout: priceFn(tokensIn, tokensOut),
    completedAt: Date.now(),
  };
}

/** A cheap heuristic when the runtime doesn't report token counts. */
export function estimateTokens(text: string): number {
  // Rough rule of thumb: ~4 chars per token. Fine for logging; not for billing.
  return Math.max(1, Math.ceil(text.length / 4));
}
