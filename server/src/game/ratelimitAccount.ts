/**
 * Account-keyed rate limit (P4-S-4 + P4-X-2 / OOM).
 *
 * A second, per-ACCOUNT limiter that COEXISTS with the P1 IP-keyed token bucket in `ratelimit.ts` — a
 * *documented transition, not a rewrite* (the P1 seam explicitly anticipated this). P1 keeps IP-level
 * abuse protection; P4 adds a per-account budget so a single authenticated player cannot flood the live
 * graph regardless of how many IPs they rotate through. The final admission decision ANDs the two.
 *
 * Anti-regression note (P4-X-2): each account is limited *independently*. Two players sharing one NAT/IP
 * are NOT throttled by each other's account budget — one hitting their cap leaves the other's account
 * decision untouched — so shared-IP households/campuses see no regressive throttling. The IP limiter still
 * guards against a genuinely abusive IP, but it never borrows one account's spend against another's.
 *
 * The clock is injected (DI) so the sliding window is deterministic under test — no wall-clock reads,
 * no timers, no I/O.
 */

export interface AccountRateLimiterOptions {
  /** Injectable clock (epoch ms). Required — this module never reads the wall clock itself. */
  now: () => number;
  /** Sliding-window length in ms. */
  windowMs: number;
  /** Max allowed checks per account within any `windowMs` window. */
  maxInWindow: number;
}

export interface AccountRateLimitDecision {
  allowed: boolean;
  /** If blocked, ms until the oldest in-window hit ages out and a slot frees; omitted when allowed. */
  retryAfterMs?: number;
}

export interface AccountRateLimiter {
  /** Attempt to spend one slot for `playerId` in the current window. */
  check(playerId: string): AccountRateLimitDecision;
  /** Forget an account's window (e.g. on logout) to bound memory. */
  forget(playerId: string): void;
}

/**
 * Create a per-account sliding-window limiter. Each account keeps a log of in-window hit timestamps;
 * a `check` succeeds iff fewer than `maxInWindow` hits fall within the trailing `windowMs`. Because the
 * window slides per account, the limit "resets" once the oldest hit ages past `windowMs`.
 */
export function createAccountRateLimiter(opts: AccountRateLimiterOptions): AccountRateLimiter {
  const { now, windowMs, maxInWindow } = opts;
  if (windowMs <= 0) throw new Error('windowMs must be > 0');
  if (maxInWindow <= 0) throw new Error('maxInWindow must be > 0');

  const hits = new Map<string, number[]>();

  return {
    check(playerId) {
      const ts = now();
      const cutoff = ts - windowMs;
      // Drop hits that have aged out of the trailing window.
      const log = (hits.get(playerId) ?? []).filter((t) => t > cutoff);

      if (log.length < maxInWindow) {
        log.push(ts);
        hits.set(playerId, log);
        return { allowed: true };
      }

      hits.set(playerId, log);
      const oldest = log[0] ?? ts; // log is non-empty here (length >= maxInWindow >= 1)
      return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - ts) };
    },
    forget(playerId) {
      hits.delete(playerId);
    },
  };
}

/**
 * Combine the IP-keyed (P1) and account-keyed (P4) decisions: a request is admitted only if BOTH allow.
 *
 * This is the composition point, kept as a tiny pure function so the AND semantics are explicit and
 * testable. It reads only `allowed` from each side so either limiter's richer result shape plugs in
 * unchanged. Per P4-X-2, the two decisions are computed from independent keys — one account exhausting
 * its budget does not affect another account that happens to share the same IP.
 */
export function combinedDecision(
  ipDecision: { allowed: boolean },
  accountDecision: { allowed: boolean },
): { allowed: boolean } {
  return { allowed: ipDecision.allowed && accountDecision.allowed };
}
