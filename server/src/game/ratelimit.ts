/**
 * Rate-limit seam (P1-S-4 / OOM-28).
 *
 * A token-bucket limiter keyed by an **opaque string**. In P1 the key is the client IP
 * (`ip:1.2.3.4`); in P4 per-account limits are added by constructing a second limiter keyed by
 * account (`acct:xyz`) and checking both — a *documented transition, not a rewrite* (the task's
 * explicit requirement). Nothing here knows or cares what the key means, so the two coexist without
 * change to this module.
 *
 * The clock is injected so the refill maths is deterministic under test — no wall-clock reads.
 */

export interface RateLimiterOptions {
  /** Max tokens in the bucket (burst size). */
  capacity: number;
  /** Tokens refilled per second (sustained rate). */
  refillPerSec: number;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** Tokens left after this check (0 when blocked). */
  remaining: number;
  /** If blocked, ms until one token is available again; 0 when allowed. */
  retryAfterMs: number;
}

export interface RateLimiter {
  /** Attempt to spend one token for `key`. */
  check(key: string): RateLimitResult;
  /** Forget a key's bucket (e.g. on disconnect) to bound memory. */
  forget(key: string): void;
}

interface Bucket {
  tokens: number;
  lastRefillTs: number;
}

/**
 * Create a token-bucket limiter. Each key gets its own lazily-created bucket that refills continuously
 * at `refillPerSec` up to `capacity`. A `check` succeeds iff a whole token is available.
 */
export function createTokenBucketLimiter(opts: RateLimiterOptions): RateLimiter {
  const { capacity, refillPerSec } = opts;
  const now = opts.now ?? (() => Date.now());
  if (capacity <= 0) throw new Error('capacity must be > 0');
  if (refillPerSec <= 0) throw new Error('refillPerSec must be > 0');

  const buckets = new Map<string, Bucket>();

  const refill = (bucket: Bucket, ts: number): void => {
    const elapsedSec = Math.max(0, (ts - bucket.lastRefillTs) / 1000);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
    bucket.lastRefillTs = ts;
  };

  return {
    check(key) {
      const ts = now();
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { tokens: capacity, lastRefillTs: ts };
        buckets.set(key, bucket);
      } else {
        refill(bucket, ts);
      }

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
      }
      const deficit = 1 - bucket.tokens;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.ceil((deficit / refillPerSec) * 1000),
      };
    },
    forget(key) {
      buckets.delete(key);
    },
  };
}
