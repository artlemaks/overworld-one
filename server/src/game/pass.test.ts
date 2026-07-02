import { describe, it, expect } from 'vitest';
import {
  type PassProgress,
  type PassReward,
  TIER_XP_THRESHOLDS,
  passTierForXp,
} from '@overworld/shared';
import { reconcilePass, claimableRewards, claimReward } from './pass.js';

function baseProgress(overrides: Partial<PassProgress> = {}): PassProgress {
  return {
    playerId: 'p1',
    seasonId: 's1',
    xp: 0,
    tier: 0,
    premiumOwned: false,
    claimedRewardIds: [],
    ...overrides,
  };
}

const track: PassReward[] = [
  { tier: 1, lane: 'free', rewardId: 'free-1', label: 'Free 1' },
  { tier: 1, lane: 'premium', rewardId: 'prem-1', label: 'Premium 1' },
  { tier: 2, lane: 'free', rewardId: 'free-2', label: 'Free 2' },
  { tier: 2, lane: 'premium', rewardId: 'prem-2', label: 'Premium 2' },
];

describe('reconcilePass', () => {
  it('adds xp and advances the tier via the shared curve', () => {
    // TIER_XP_THRESHOLDS[1] completes tier 1.
    const xp = TIER_XP_THRESHOLDS[1] as number;
    const next = reconcilePass(baseProgress(), xp);
    expect(next.xp).toBe(xp);
    expect(next.tier).toBe(passTierForXp(xp));
    expect(next.tier).toBeGreaterThanOrEqual(1);
  });

  it('is immutable — the input progress is not mutated', () => {
    const progress = baseProgress();
    reconcilePass(progress, 500);
    expect(progress.xp).toBe(0);
    expect(progress.tier).toBe(0);
  });

  it('accumulates xp across reconciliations', () => {
    const a = reconcilePass(baseProgress(), 100);
    const b = reconcilePass(a, 150);
    expect(b.xp).toBe(250);
  });

  it('floors negative xp so xp stays monotonic', () => {
    const next = reconcilePass(baseProgress({ xp: 300, tier: passTierForXp(300) }), -100);
    expect(next.xp).toBe(300);
  });

  it('uses an IDENTICAL curve for premium and free at the same xp (fairness guarantee)', () => {
    const xp = TIER_XP_THRESHOLDS[3] as number;
    const free = reconcilePass(baseProgress({ premiumOwned: false }), xp);
    const premium = reconcilePass(baseProgress({ premiumOwned: true }), xp);
    expect(premium.tier).toBe(free.tier);
    expect(premium.xp).toBe(free.xp);
  });
});

describe('claimableRewards', () => {
  it('offers free-lane rewards at or below the reached tier, ungated', () => {
    const progress = baseProgress({ tier: 2, premiumOwned: false });
    const ids = claimableRewards(progress, track).map((r) => r.rewardId);
    expect(ids).toContain('free-1');
    expect(ids).toContain('free-2');
  });

  it('gates premium-lane rewards behind premiumOwned', () => {
    const noPremium = baseProgress({ tier: 2, premiumOwned: false });
    const ids = claimableRewards(noPremium, track).map((r) => r.rewardId);
    expect(ids).not.toContain('prem-1');
    expect(ids).not.toContain('prem-2');
  });

  it('unlocks premium-lane rewards when premiumOwned', () => {
    const withPremium = baseProgress({ tier: 2, premiumOwned: true });
    const ids = claimableRewards(withPremium, track).map((r) => r.rewardId);
    expect(ids).toEqual(['free-1', 'prem-1', 'free-2', 'prem-2']);
  });

  it('excludes rewards above the reached tier', () => {
    const progress = baseProgress({ tier: 1, premiumOwned: true });
    const ids = claimableRewards(progress, track).map((r) => r.rewardId);
    expect(ids).toContain('free-1');
    expect(ids).toContain('prem-1');
    expect(ids).not.toContain('free-2');
    expect(ids).not.toContain('prem-2');
  });

  it('excludes already-claimed rewards', () => {
    const progress = baseProgress({ tier: 2, premiumOwned: true, claimedRewardIds: ['free-1'] });
    const ids = claimableRewards(progress, track).map((r) => r.rewardId);
    expect(ids).not.toContain('free-1');
    expect(ids).toContain('free-2');
  });
});

describe('claimReward', () => {
  it('adds the reward id to the claimed set', () => {
    const next = claimReward(baseProgress(), 'free-1');
    expect(next.claimedRewardIds).toEqual(['free-1']);
  });

  it('is idempotent — claiming twice does not duplicate', () => {
    const once = claimReward(baseProgress(), 'free-1');
    const twice = claimReward(once, 'free-1');
    expect(twice.claimedRewardIds).toEqual(['free-1']);
  });

  it('is immutable — the input progress is not mutated', () => {
    const progress = baseProgress();
    claimReward(progress, 'free-1');
    expect(progress.claimedRewardIds).toEqual([]);
  });
});
