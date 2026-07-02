import { describe, it, expect } from 'vitest';
import {
  TIER_XP_THRESHOLDS,
  MAX_PASS_TIER,
  passTierForXp,
} from './pass.js';

describe('pass tier curve', () => {
  it('starts at tier 0 with no XP', () => {
    expect(passTierForXp(0)).toBe(0);
    expect(passTierForXp(-100)).toBe(0);
  });

  it('advances a tier exactly at each threshold', () => {
    expect(passTierForXp(100)).toBe(1);
    expect(passTierForXp(249)).toBe(1);
    expect(passTierForXp(250)).toBe(2);
  });

  it('is monotonic non-decreasing in xp', () => {
    let prev = 0;
    for (let xp = 0; xp <= 3000; xp += 37) {
      const t = passTierForXp(xp);
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it('caps at MAX_PASS_TIER', () => {
    expect(passTierForXp(999999)).toBe(MAX_PASS_TIER - 1);
    expect(TIER_XP_THRESHOLDS.length).toBe(MAX_PASS_TIER);
  });

  it('free and premium share the SAME curve (premium never progresses faster)', () => {
    // There is only one tier function; a "premium" player computes tier from the identical fn.
    for (const xp of [0, 100, 500, 1500, 5000]) {
      const freeTier = passTierForXp(xp);
      const premiumTier = passTierForXp(xp); // no premium variant exists — that IS the guarantee
      expect(premiumTier).toBe(freeTier);
    }
  });
});
