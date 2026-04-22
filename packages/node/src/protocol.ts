// Wire protocol between a node client and the coordinator. The mock and the
// real coordinator both speak this schema; changing it is a breaking change.
import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

/** A work unit the coordinator hands out. */
export const JobSchema = z.object({
  id: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.enum(['chat', 'completion']),
  model: z.string().min(1),
  prompt: z.string().min(1),
  maxTokens: z.number().int().positive().max(4096).default(256),
  temperature: z.number().min(0).max(2).default(0.7),
  /** Soft budget in $DOZZZE the consumer is willing to pay. */
  payout: z.number().nonnegative(),
  createdAt: z.number().int().positive(),
});
export type Job = z.infer<typeof JobSchema>;

/** A node's response to a Job. */
export const ResultSchema = z.object({
  jobId: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  nodeId: z.string().min(1),
  output: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** Realized payout in $DOZZZE. MVP mocks this. */
  payout: z.number().nonnegative(),
  completedAt: z.number().int().positive(),
});
export type Result = z.infer<typeof ResultSchema>;

/** A failure to complete a Job. */
export const FailureSchema = z.object({
  jobId: z.string().min(1),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  nodeId: z.string().min(1),
  reason: z.string().min(1),
  kind: z.enum(['timeout', 'runtime', 'unsupported-model', 'refused']),
  at: z.number().int().positive(),
});
export type Failure = z.infer<typeof FailureSchema>;

/** Validates a Job from an untrusted source. Throws a `ZodError` on bad input. */
export function parseJob(raw: unknown): Job {
  return JobSchema.parse(raw);
}

/** Validates a Result from an untrusted source. */
export function parseResult(raw: unknown): Result {
  return ResultSchema.parse(raw);
}
