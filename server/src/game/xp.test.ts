import { describe, it, expect } from 'vitest';
import {
  nextComboStreak,
  comboMultiplier,
  xpForContribution,
  DEFAULT_XP_CONFIG,
  type XpConfig,
} from './xp.js';

const cfg: XpConfig = DEFAULT_XP_CONFIG;

describe('combo streak (server-derived)', () => {
  it('starts a fresh streak at 1 on a first-ever contribution', () => {
    expect(nextComboStreak(0, null, 1000, cfg)).toBe(1);
  });

  it('extends the streak when contributions land inside the combo window', () => {
    expect(nextComboStreak(3, 1000, 1000 + cfg.comboWindowMs, cfg)).toBe(4);
  });

  it('resets the streak to 1 after too long a gap', () => {
    expect(nextComboStreak(5, 1000, 1000 + cfg.comboWindowMs + 1, cfg)).toBe(1);
  });
});

describe('combo multiplier', () => {
  it('is 1.0x at streak 1', () => {
    expect(comboMultiplier(1, cfg)).toBe(1);
  });

  it('grows by comboStep per streak step', () => {
    expect(comboMultiplier(3, cfg)).toBeCloseTo(1 + 2 * cfg.comboStep);
  });

  it('never exceeds the comboCap no matter how long the streak (non-P2W bound)', () => {
    expect(comboMultiplier(1000, cfg)).toBe(cfg.comboCap);
  });
});

describe('xp for a contribution', () => {
  it('mints base xp at streak 1', () => {
    // 100 points * 0.5 xpPerPoint * 1.0 combo = 50
    expect(xpForContribution({ points: 100, streak: 1, priorXp: 0 }, cfg)).toBe(50);
  });

  it('scales with the combo multiplier', () => {
    // 100 * 0.5 * (1 + 2*0.1) = 60
    expect(xpForContribution({ points: 100, streak: 3, priorXp: 0 }, cfg)).toBe(60);
  });

  it('applies diminishing returns past the threshold', () => {
    const below = xpForContribution({ points: 100, streak: 1, priorXp: 0 }, cfg);
    const above = xpForContribution(
      { points: 100, streak: 1, priorXp: cfg.diminishingThresholdXp }, cfg,
    );
    expect(above).toBe(Math.round(below * cfg.diminishingRate));
  });

  it('clamps cumulative xp to the per-event cap', () => {
    const remaining = xpForContribution(
      { points: 100_000, streak: 1, priorXp: cfg.perEventXpCap - 10 }, cfg,
    );
    expect(remaining).toBe(10);
  });

  it('never awards negative xp once the cap is reached', () => {
    expect(xpForContribution({ points: 100, streak: 1, priorXp: cfg.perEventXpCap }, cfg)).toBe(0);
  });
});
