import { describe, it, expect } from 'vitest';
import { fnv1aHex, verifyPow } from './challenge.js';

/** Brute-force a nonce satisfying the difficulty — mirrors what the client does. */
function solve(prompt: string, difficulty: number): string {
  const target = '0'.repeat(difficulty);
  for (let n = 0; n < 5_000_000; n++) {
    const nonce = n.toString(36);
    if (fnv1aHex(prompt + nonce).startsWith(target)) return nonce;
  }
  throw new Error('no solution found in bound');
}

describe('proof-of-work challenge', () => {
  it('is deterministic', () => {
    expect(fnv1aHex('abc')).toBe(fnv1aHex('abc'));
    expect(fnv1aHex('abc')).not.toBe(fnv1aHex('abd'));
  });

  it('a solved nonce verifies at difficulty 1', () => {
    const prompt = 'session-xyz';
    const nonce = solve(prompt, 1);
    expect(verifyPow(prompt, nonce, 1)).toBe(true);
  });

  it('rejects a wrong nonce', () => {
    // Find a nonce whose hash does NOT start with 0, to guarantee a negative.
    let bad = 'z';
    for (let n = 0; n < 1000; n++) {
      const cand = n.toString(36);
      if (!fnv1aHex('p' + cand).startsWith('0')) { bad = cand; break; }
    }
    expect(verifyPow('p', bad, 1)).toBe(false);
  });

  it('difficulty 0 accepts anything', () => {
    expect(verifyPow('p', 'anything', 0)).toBe(true);
  });
});
