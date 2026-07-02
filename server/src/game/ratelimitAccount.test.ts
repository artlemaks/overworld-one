import { describe, it, expect } from 'vitest';
import { createAccountRateLimiter, combinedDecision } from './ratelimitAccount.js';

describe('P4-S-4 account-keyed rate limiter', () => {
  it('allows up to maxInWindow per account, then blocks', () => {
    const t = 0;
    const limiter = createAccountRateLimiter({ now: () => t, windowMs: 1000, maxInWindow: 3 });
    expect(limiter.check('acct:a').allowed).toBe(true);
    expect(limiter.check('acct:a').allowed).toBe(true);
    expect(limiter.check('acct:a').allowed).toBe(true);
    const blocked = limiter.check('acct:a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets once the window slides past the oldest hit', () => {
    let t = 0;
    const limiter = createAccountRateLimiter({ now: () => t, windowMs: 1000, maxInWindow: 1 });
    expect(limiter.check('acct:a').allowed).toBe(true);
    expect(limiter.check('acct:a').allowed).toBe(false);
    t = 1001; // oldest hit (t=0) has aged out of the trailing 1000ms window
    expect(limiter.check('acct:a').allowed).toBe(true);
  });

  it('reports retry-after equal to when the oldest hit ages out', () => {
    const t = 200;
    const limiter = createAccountRateLimiter({ now: () => t, windowMs: 1000, maxInWindow: 1 });
    limiter.check('acct:a'); // recorded at t=200
    const blocked = limiter.check('acct:a');
    expect(blocked.retryAfterMs).toBe(1000); // 200 + 1000 - 200
  });

  it('rejects invalid configuration', () => {
    expect(() => createAccountRateLimiter({ now: () => 0, windowMs: 0, maxInWindow: 1 })).toThrow();
    expect(() => createAccountRateLimiter({ now: () => 0, windowMs: 1000, maxInWindow: 0 })).toThrow();
  });
});

describe('P4-X-2 combinedDecision (IP AND account)', () => {
  it('admits only when BOTH the IP and account decisions allow', () => {
    expect(combinedDecision({ allowed: true }, { allowed: true }).allowed).toBe(true);
    expect(combinedDecision({ allowed: true }, { allowed: false }).allowed).toBe(false);
    expect(combinedDecision({ allowed: false }, { allowed: true }).allowed).toBe(false);
    expect(combinedDecision({ allowed: false }, { allowed: false }).allowed).toBe(false);
  });

  it('does NOT throttle a co-located account when a shared-IP neighbour hits its cap (no regression)', () => {
    const t = 0;
    // Two distinct players behind ONE shared IP. Account budget of 1/window.
    const accountLimiter = createAccountRateLimiter({ now: () => t, windowMs: 1000, maxInWindow: 1 });

    // Player A exhausts THEIR account budget.
    expect(accountLimiter.check('acct:A').allowed).toBe(true);
    const aSecond = accountLimiter.check('acct:A');
    expect(aSecond.allowed).toBe(false);

    // Player B, on the same IP, still gets their own independent account budget.
    const bDecision = accountLimiter.check('acct:B');
    expect(bDecision.allowed).toBe(true);

    // The shared IP is still healthy (IP limiter would allow); combined = account decision per player.
    const ipAllow = { allowed: true };
    // A is (correctly) blocked by their own account budget…
    expect(combinedDecision(ipAllow, aSecond).allowed).toBe(false);
    // …while B — same IP — is admitted. No regressive cross-account throttling.
    expect(combinedDecision(ipAllow, bDecision).allowed).toBe(true);
  });
});
