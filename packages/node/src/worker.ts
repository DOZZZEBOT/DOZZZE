// Runs an inference job against a local Ollama endpoint and returns a Result.
// LM Studio is detected but MVP only routes work to Ollama to keep the prompt
// template consistent. (LM Studio as a worker target is v0.2.)

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

export interface WorkerDeps {
  ollamaUrl: string;
  nodeId: string;
  /** Mocked payout formula. Returns $DOZZZE to credit for a given Result. */
  priceFn?: (tokensIn: number, tokensOut: number) => number;
}

function defaultPrice(tokensIn: number, tokensOut: number): number {
  // Mock: 1 $DOZZZE per 1K tokens in+out.
  return (tokensIn + tokensOut) / 1000;
}

/** Runs a single Job via Ollama's `/api/generate`. Returns a Result on success. */
export async function runJob(job: Job, deps: WorkerDeps): Promise<Result> {
  const t0 = Date.now();
  const res = await fetch(`${deps.ollamaUrl}/api/generate`, {
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
    throw new Error(`Ollama /api/generate failed: HTTP ${res.status}`);
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

/** A cheap heuristic when the runtime doesn't report token counts. */
export function estimateTokens(text: string): number {
  // Rough rule of thumb: ~4 chars per token. Fine for logging; not for billing.
  return Math.max(1, Math.ceil(text.length / 4));
}
