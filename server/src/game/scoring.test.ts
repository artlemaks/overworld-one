import { describe, it, expect } from 'vitest';
import type { ContributionMessage } from '@overworld/shared';
import {
  computeContributionPoints,
  skillFactor,
  ACTION_BASE_POINTS,
  POWER_MULTIPLIER_CAP,
} from './scoring.js';

const msg = (over: Partial<ContributionMessage> = {}): ContributionMessage => ({
  playerId: 'p1',
  actionType: 'strike',
  inputParams: { aimAccuracy: 1, timingQuality: 1 },
  clientTs: 0,
  ...over,
});

describe('server-authoritative scoring', () => {
  it('awards full base points for a flawless strike', () => {
    expect(computeContributionPoints(msg())).toBe(ACTION_BASE_POINTS.strike);
  });

  it('scales points by the blended aim/timing skill factor', () => {
    // 0.6*aim + 0.4*timing = 0.6*1 + 0.4*0 = 0.6 -> 60 of 100
    expect(computeContributionPoints(msg({ inputParams: { aimAccuracy: 1, timingQuality: 0 } }))).toBe(60);
  });

  it('weights action types differently', () => {
    expect(computeContributionPoints(msg({ actionType: 'support' }))).toBe(ACTION_BASE_POINTS.support);
    expect(computeContributionPoints(msg({ actionType: 'rally' }))).toBe(ACTION_BASE_POINTS.rally);
  });

  it('ignores a client-asserted accuracy — only primitive signals feed the formula', () => {
    // A cheating client pins accuracy=1 but sends zeroed real signals: score must be 0.
    const cheat = msg({ inputParams: { accuracy: 1, aimAccuracy: 0, timingQuality: 0 } });
    expect(computeContributionPoints(cheat)).toBe(0);
  });

  it('clamps inflated/negative signals into [0,1] before scoring', () => {
    expect(skillFactor(msg({ inputParams: { aimAccuracy: 9, timingQuality: 9 } }))).toBe(POWER_MULTIPLIER_CAP);
    expect(skillFactor(msg({ inputParams: { aimAccuracy: -5, timingQuality: -5 } }))).toBe(0);
  });

  it('treats non-finite signals as zero (never NaN points)', () => {
    const points = computeContributionPoints(
      msg({ inputParams: { aimAccuracy: Number.POSITIVE_INFINITY, timingQuality: Number.NaN } }),
    );
    expect(points).toBe(0);
  });

  it('never lets the skill factor exceed the 1.0 power cap (non-P2W guardrail)', () => {
    expect(skillFactor(msg())).toBeLessThanOrEqual(POWER_MULTIPLIER_CAP);
  });
});
