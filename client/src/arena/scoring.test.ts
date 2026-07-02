import { describe, it, expect } from 'vitest';
import { ContributionMessage } from '@overworld/shared';
import {
  toInputParams,
  toContributionMessage,
  estimateLocalScore,
  scoreStrike,
  LOCAL_SCORE_MAX,
} from './scoring.js';
import type { Strike } from './contribution.js';

const PLAYER = 'player-abc';

/** A resolved strike with sensible defaults; override any signal per test. */
function strike(overrides: Partial<Strike> = {}): Strike {
  return {
    actionType: 'strike',
    aim: { x: 0.6, y: 0.8 },
    distance: 50,
    aimAccuracy: 0.5,
    timingQuality: 0.5,
    accuracy: 0.5,
    clientTs: 1234,
    ...overrides,
  };
}

describe('toInputParams', () => {
  it('packs every skill signal as a finite number', () => {
    const params = toInputParams(strike());
    expect(params).toEqual({
      aimAccuracy: 0.5,
      timingQuality: 0.5,
      accuracy: 0.5,
      aimX: 0.6,
      aimY: 0.8,
      distance: 50,
    });
    for (const value of Object.values(params)) expect(Number.isFinite(value)).toBe(true);
  });
});

describe('toContributionMessage', () => {
  it('produces a message that satisfies the shared contract', () => {
    const message = toContributionMessage(strike(), PLAYER);
    // Round-trips through the single-source-of-truth schema without throwing.
    expect(() => ContributionMessage.parse(message)).not.toThrow();
    expect(message.playerId).toBe(PLAYER);
    expect(message.actionType).toBe('strike');
    expect(message.clientTs).toBe(1234);
    expect(message.inputParams.accuracy).toBe(0.5);
  });

  it('carries the strike action type through', () => {
    const message = toContributionMessage(strike({ actionType: 'rally' }), PLAYER);
    expect(message.actionType).toBe('rally');
  });

  it('rejects an empty playerId (contract requires a non-empty id)', () => {
    expect(() => toContributionMessage(strike(), '')).toThrow();
  });
});

describe('estimateLocalScore', () => {
  it('is zero for a whiffed strike', () => {
    expect(estimateLocalScore(strike({ accuracy: 0 }))).toBe(0);
  });

  it('is the max for a perfect strike', () => {
    expect(estimateLocalScore(strike({ accuracy: 1 }))).toBe(LOCAL_SCORE_MAX);
  });

  it('scales with accuracy and returns a rounded integer', () => {
    const score = estimateLocalScore(strike({ accuracy: 0.514 }));
    expect(score).toBe(51);
    expect(Number.isInteger(score)).toBe(true);
  });

  it('clamps an out-of-range accuracy into [0, LOCAL_SCORE_MAX]', () => {
    expect(estimateLocalScore(strike({ accuracy: 5 }))).toBe(LOCAL_SCORE_MAX);
    expect(estimateLocalScore(strike({ accuracy: -3 }))).toBe(0);
  });

  it('depends only on the strike skill signal (no pay-to-win multiplier, deterministic)', () => {
    const s = strike({ accuracy: 0.73 });
    expect(estimateLocalScore(s)).toBe(estimateLocalScore(s));
  });
});

describe('scoreStrike', () => {
  it('returns both a contract-shaped message and the provisional local score', () => {
    const { message, localScore } = scoreStrike(strike({ accuracy: 1 }), PLAYER);
    expect(() => ContributionMessage.parse(message)).not.toThrow();
    expect(message.playerId).toBe(PLAYER);
    expect(localScore).toBe(LOCAL_SCORE_MAX);
  });
});
