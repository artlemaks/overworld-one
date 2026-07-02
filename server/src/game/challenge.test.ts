import { describe, it, expect } from 'vitest';
import { verifyPow } from '@overworld/shared';
import { createChallengeGate } from './challenge.js';

/** Deterministic id generator: a fresh sequential id on every call. */
const seqIds = () => {
  let n = 0;
  return () => `id-${n++}`;
};

/** Brute-force a nonce that satisfies the PoW for the given prompt/difficulty. */
const solveNonce = (prompt: string, difficulty: number): string => {
  for (let i = 0; i < 1_000_000; i++) {
    const nonce = String(i);
    if (verifyPow(prompt, nonce, difficulty)) return nonce;
  }
  throw new Error('no nonce found (unexpected for difficulty 1)');
};

describe('challenge gate — solving', () => {
  it('accepts a brute-forced difficulty-1 nonce and marks the player passed', () => {
    const t = 1000;
    const gate = createChallengeGate({ now: () => t, genId: seqIds(), difficulty: 1, ttlMs: 60_000 });

    const challenge = gate.issue('p1');
    expect(challenge.kind).toBe('pow');
    expect(challenge.difficulty).toBe(1);
    expect(challenge.issuedAtTs).toBe(1000);
    expect(challenge.expiresAtTs).toBe(61_000);
    expect(gate.hasPassed('p1')).toBe(false);

    const answer = solveNonce(challenge.prompt, 1);
    const r = gate.solve({ challengeId: challenge.challengeId, answer });
    expect(r.ok).toBe(true);
    expect(gate.hasPassed('p1')).toBe(true);
  });
});

describe('challenge gate — rejection', () => {
  it('rejects an unknown challenge id', () => {
    const t = 0;
    const gate = createChallengeGate({ now: () => t, genId: seqIds(), difficulty: 1, ttlMs: 60_000 });
    const r = gate.solve({ challengeId: 'nope', answer: '0' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('unknown_challenge');
  });

  it('rejects an expired challenge', () => {
    let t = 0;
    const gate = createChallengeGate({ now: () => t, genId: seqIds(), difficulty: 1, ttlMs: 1000 });
    const challenge = gate.issue('p1');
    const answer = solveNonce(challenge.prompt, 1);
    t = 5000; // past expiry
    const r = gate.solve({ challengeId: challenge.challengeId, answer });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('expired');
    expect(gate.hasPassed('p1')).toBe(false);
  });

  it('rejects a wrong answer', () => {
    const t = 0;
    const gate = createChallengeGate({ now: () => t, genId: seqIds(), difficulty: 4, ttlMs: 60_000 });
    const challenge = gate.issue('p1');
    // 'x' almost certainly does not yield 4 leading zero hex chars.
    const r = gate.solve({ challengeId: challenge.challengeId, answer: 'x' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('wrong_answer');
    expect(gate.hasPassed('p1')).toBe(false);
  });
});

describe('challenge gate — first-contribution admission', () => {
  it('blocks the first contribution until the challenge is passed', () => {
    const t = 0;
    const gate = createChallengeGate({ now: () => t, genId: seqIds(), difficulty: 1, ttlMs: 60_000 });
    const challenge = gate.issue('p1');

    const before = gate.requireForFirstContribution('p1');
    expect(before.allowed).toBe(false);
    expect(before.reason).toBe('challenge_unsolved');

    const answer = solveNonce(challenge.prompt, 1);
    gate.solve({ challengeId: challenge.challengeId, answer });

    expect(gate.requireForFirstContribution('p1').allowed).toBe(true);
  });

  it('blocks a player who never received a challenge', () => {
    const t = 0;
    const gate = createChallengeGate({ now: () => t, genId: seqIds(), difficulty: 1, ttlMs: 60_000 });
    expect(gate.requireForFirstContribution('ghost').allowed).toBe(false);
  });
});
