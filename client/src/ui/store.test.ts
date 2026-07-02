import { describe, it, expect } from 'vitest';
import { storeViewModel, passTrackViewModel } from './store.js';
import type { PassProgress, PassReward, StoreItem } from '@overworld/shared';

const catalog: StoreItem[] = [
  { sku: 'a', name: 'Avatar', kind: 'cosmetic', priceBand: 'b199', effectKind: 'avatar', sparkAmount: 0, grantsCosmeticIds: [] },
  { sku: 'p', name: 'Premium Pass', kind: 'premium-pass', priceBand: 'b699', effectKind: null, sparkAmount: 0, grantsCosmeticIds: [] },
  { sku: 'v', name: 'Vanguard Kit', kind: 'vanguard-kit', priceBand: 'b999', effectKind: 'badge', sparkAmount: 0, grantsCosmeticIds: ['x'] },
];

const track: PassReward[] = [
  { tier: 1, lane: 'free', rewardId: 'f1', label: 'Free 1' },
  { tier: 1, lane: 'premium', rewardId: 'p1', label: 'Prem 1' },
  { tier: 3, lane: 'free', rewardId: 'f3', label: 'Free 3' },
];

describe('storeViewModel', () => {
  it('formats price bands as dollars', () => {
    const rows = storeViewModel(catalog);
    expect(rows.map((r) => r.priceUsd)).toEqual(['$1.99', '$6.99', '$9.99']);
  });
});

describe('passTrackViewModel', () => {
  const progress = (tier: number, premiumOwned: boolean): PassProgress => ({
    playerId: 'p1',
    seasonId: 's1',
    xp: 300,
    tier,
    premiumOwned,
    claimedRewardIds: [],
  });

  it('unlocks free rewards at/under the current tier', () => {
    const vm = passTrackViewModel(progress(2, false), track);
    expect(vm.rewards.find((r) => r.rewardId === 'f1')!.unlocked).toBe(true); // tier1 <= 2
    expect(vm.rewards.find((r) => r.rewardId === 'f3')!.unlocked).toBe(false); // tier3 > 2
  });

  it('locks premium rewards without the premium pass — even at a reached tier', () => {
    const vm = passTrackViewModel(progress(2, false), track);
    expect(vm.rewards.find((r) => r.rewardId === 'p1')!.unlocked).toBe(false);
  });

  it('unlocks premium rewards once premium is owned (same tier — never sooner)', () => {
    const vm = passTrackViewModel(progress(2, true), track);
    expect(vm.rewards.find((r) => r.rewardId === 'p1')!.unlocked).toBe(true);
  });

  it('surfaces the authoritative tier + xp', () => {
    const vm = passTrackViewModel(progress(5, false), track);
    expect(vm.tier).toBe(5);
    expect(vm.xp).toBe(300);
  });
});
