// Wire protocol shared by every DOZZZE component that speaks HTTP.
// Adding a field here is a breaking change — bump PROTOCOL_VERSION and
// write a migration note before merging.
import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;

/** A work unit the coordinator hands out to a node. */
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
  /** Solana address the node wants earnings credited to. Required for payouts,
   *  optional when the node opts out of $DOZZZE (volunteers, testbeds).
   *  Length is intentionally permissive — the coordinator defers shape
   *  validation to `new PublicKey(...)` at payout time. */
  walletAddress: z.string().min(1).max(64).optional(),
  output: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  /** Realized payout in $DOZZZE. Mocked in v0.1; devnet-backed in v0.2. */
  payout: z.number().nonnegative(),
  completedAt: z.number().int().positive(),
  /** Optional Solana transaction signature when the node settles on-chain. */
  settlementTx: z.string().optional(),
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

/** Submit-a-new-job request body. */
export const SubmitRequestSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  kind: z.enum(['chat', 'completion']),
  model: z.string().min(1),
  prompt: z.string().min(1),
  maxTokens: z.number().int().positive().max(4096).default(256),
  temperature: z.number().min(0).max(2).default(0.7),
  payout: z.number().nonnegative(),
});
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;

/** Submit response — coordinator echoes the full Job it queued. */
export const SubmitResponseSchema = z.object({ job: JobSchema });
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

/** Poll response. `null` when the queue is empty — node should try again later. */
export const PollResponseSchema = z.object({ job: JobSchema.nullable() });
export type PollResponse = z.infer<typeof PollResponseSchema>;

/** Report a completed result. Coordinator returns the stored Result. */
export const ReportRequestSchema = z.object({ result: ResultSchema });
export type ReportRequest = z.infer<typeof ReportRequestSchema>;

export const ReportResponseSchema = z.object({
  accepted: z.literal(true),
  result: ResultSchema,
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;

/** Validates a Job from an untrusted source. Throws a `ZodError` on bad input. */
export function parseJob(raw: unknown): Job {
  return JobSchema.parse(raw);
}

/** Validates a Result from an untrusted source. */
export function parseResult(raw: unknown): Result {
  return ResultSchema.parse(raw);
}
