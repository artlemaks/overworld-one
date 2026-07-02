import { PRICE_BAND_CENTS } from '@overworld/shared';
import type { PassProgress, PassReward, StoreItem } from '@overworld/shared';

/**
 * Store + pass-track screen model (P4-C / OOM).
 *
 * The PURE, testable core of the store and the pass-track UI. No Pixi/DOM import (indication
 * `client-screens-pure-and-testable`). The pass-track view NEVER implies premium progresses faster:
 * both lanes share ONE tier (the shared `passTierForXp` curve), and a premium reward is merely *locked*
 * behind ownership, not reached sooner (indication `monetization-never-pay-to-win`).
 */

export interface StoreRow {
  sku: string;
  name: string;
  /** Formatted price, e.g. "$4.99". */
  priceUsd: string;
}

/** Format USD cents as a "$X.YY" string. */
function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Map the store catalog into display rows with formatted prices. Pure. */
export function storeViewModel(catalog: StoreItem[]): StoreRow[] {
  return catalog.map((item) => ({
    sku: item.sku,
    name: item.name,
    priceUsd: formatUsd(PRICE_BAND_CENTS[item.priceBand]),
  }));
}

export interface PassRewardRow {
  rewardId: string;
  lane: 'free' | 'premium';
  tier: number;
  /** Reached this tier AND (free lane OR premium owned). */
  unlocked: boolean;
}

export interface PassTrackViewModel {
  tier: number;
  xp: number;
  rewards: PassRewardRow[];
}

/**
 * Build the pass-track view. A reward is unlocked when the player has reached its tier and either it is a
 * free-lane reward or they own the premium pass. `progress.tier` is authoritative (reconciled server-side
 * from XP via the shared identical curve).
 */
export function passTrackViewModel(progress: PassProgress, track: PassReward[]): PassTrackViewModel {
  return {
    tier: progress.tier,
    xp: progress.xp,
    rewards: track.map((r) => ({
      rewardId: r.rewardId,
      lane: r.lane,
      tier: r.tier,
      unlocked: r.tier <= progress.tier && (r.lane === 'free' || progress.premiumOwned),
    })),
  };
}
