// Simple bearer-token auth + per-key rate limiter. Applied only to endpoints
// that mutate state (/submit, /report). Read endpoints (/health, /poll,
// /result) stay open because the pull-vs-push asymmetry makes them cheap.
//
// When no keys are configured, auth is DISABLED — this is intentional so
// local dev and CI need no env setup. Production deployments MUST set keys.
import type { MiddlewareHandler } from 'hono';
import { createHash, timingSafeEqual } from 'node:crypto';

export interface AuthOptions {
  /** Allowed bearer tokens. Empty array = auth disabled. */
  apiKeys: readonly string[];
  /** Max requests per window per key. Default: 60. */
  rateLimit?: number;
  /** Window length in ms. Default: 60_000 (1 minute). */
  windowMs?: number;
}

type CounterBucket = { count: number; resetAt: number };

function hashKey(key: string): Buffer {
  return createHash('sha256').update(key).digest();
}

/** Build a bearer-token auth middleware. Set keys via `DOZZZE_COORD_API_KEYS`. */
export function bearerAuth(opts: AuthOptions): MiddlewareHandler {
  const hashes = opts.apiKeys.map(hashKey);
  const limit = opts.rateLimit ?? 60;
  const windowMs = opts.windowMs ?? 60_000;
  const counters = new Map<string, CounterBucket>();
  const authDisabled = hashes.length === 0;

  return async (c, next) => {
    if (authDisabled) {
      await next();
      return;
    }
    const header = c.req.header('authorization') ?? '';
    const prefix = 'Bearer ';
    if (!header.startsWith(prefix)) {
      return c.json({ error: 'missing bearer token' }, 401);
    }
    const provided = header.slice(prefix.length).trim();
    const providedHash = hashKey(provided);
    const matched = hashes.some((h) => h.length === providedHash.length && timingSafeEqual(h, providedHash));
    if (!matched) {
      return c.json({ error: 'invalid token' }, 401);
    }

    // Rate-limit per matched hash (not per raw key, so the key itself never
    // becomes a map key on disk / in a core dump).
    const bucketKey = providedHash.toString('hex');
    const now = Date.now();
    const bucket = counters.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      counters.set(bucketKey, { count: 1, resetAt: now + windowMs });
    } else {
      bucket.count += 1;
      if (bucket.count > limit) {
        const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
        c.header('retry-after', String(retryAfter));
        return c.json({ error: 'rate limit exceeded', retryAfter }, 429);
      }
    }
    await next();
  };
}

/** Parse the comma-separated env var into a trimmed non-empty list. */
export function parseApiKeys(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
