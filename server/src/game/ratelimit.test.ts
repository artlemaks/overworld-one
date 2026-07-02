import { describe, it, expect } from 'vitest';
import { createTokenBucketLimiter } from './ratelimit.js';

describe('token-bucket rate limiter', () => {
  it('allows a burst up to capacity, then blocks', () => {
    const t = 0;
    const limiter = createTokenBucketLimiter({ capacity: 3, refillPerSec: 1, now: () => t });
    expect(limiter.check('ip:a').allowed).toBe(true);
    expect(limiter.check('ip:a').allowed).toBe(true);
    expect(limiter.check('ip:a').allowed).toBe(true);
    const blocked = limiter.check('ip:a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills over time', () => {
    let t = 0;
    const limiter = createTokenBucketLimiter({ capacity: 1, refillPerSec: 1, now: () => t });
    expect(limiter.check('ip:a').allowed).toBe(true);
    expect(limiter.check('ip:a').allowed).toBe(false);
    t = 1000; // one second -> one token
    expect(limiter.check('ip:a').allowed).toBe(true);
  });

  it('keys are independent (IP now, account later coexist on the same seam)', () => {
    const t = 0;
    const limiter = createTokenBucketLimiter({ capacity: 1, refillPerSec: 1, now: () => t });
    expect(limiter.check('ip:a').allowed).toBe(true);
    expect(limiter.check('ip:a').allowed).toBe(false);
    // A different key has its own bucket.
    expect(limiter.check('acct:x').allowed).toBe(true);
  });

  it('reports a plausible retry-after when blocked', () => {
    const t = 0;
    const limiter = createTokenBucketLimiter({ capacity: 1, refillPerSec: 2, now: () => t });
    limiter.check('ip:a');
    const blocked = limiter.check('ip:a');
    expect(blocked.retryAfterMs).toBe(500); // 1 token / 2 per sec = 500ms
  });

  it('rejects invalid configuration', () => {
    expect(() => createTokenBucketLimiter({ capacity: 0, refillPerSec: 1 })).toThrow();
    expect(() => createTokenBucketLimiter({ capacity: 1, refillPerSec: 0 })).toThrow();
  });
});
