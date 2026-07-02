import { type PassProgress, type PassReward, passTierForXp } from '@overworld/shared';

/**
 * Season pass engine (P4-P-3 / OOM).
 *
 * Reconciles a player's {@link PassProgress} from XP at resolution and resolves which track rewards are
 * claimable. This module owns the *server-side* pass logic; the shared package owns the XP→tier curve.
 *
 * **Non-pay-to-win — the fairness guarantee (scope §8, indication `monetization-never-pay-to-win`).**
 * Both lanes are reconciled through the SAME shared {@link passTierForXp} curve. There is deliberately
 * NO premium variant of the tier function: premium never buys faster progression, it only unlocks
 * cosmetic/commemorative rewards at tiers the free player also reaches. `premiumOwned` gates *which
 * rewards* a player may claim, never *how fast* they tier up.
 *
 * Pure and immutable: every function returns a fresh {@link PassProgress}; no input is mutated, and there
 * is no clock, no randomness, and no I/O.
 */

/**
 * Add `xpEarned` to a player's pass and recompute their tier through the shared curve. Immutable — returns
 * a new {@link PassProgress}. Negative `xpEarned` is floored at zero contribution so xp is monotonic.
 */
export function reconcilePass(progress: PassProgress, xpEarned: number): PassProgress {
  const xp = progress.xp + Math.max(0, xpEarned);
  return {
    ...progress,
    xp,
    tier: passTierForXp(xp),
  };
}

/**
 * The rewards a player may currently claim from `track`: those at a tier at or below the player's reached
 * `tier`, on the free lane always, on the premium lane ONLY when `premiumOwned`, and excluding any reward
 * already in `claimedRewardIds`. Order follows the input track.
 */
export function claimableRewards(progress: PassProgress, track: PassReward[]): PassReward[] {
  const claimed = new Set(progress.claimedRewardIds);
  return track.filter((reward) => {
    if (reward.tier > progress.tier) return false;
    if (reward.lane === 'premium' && !progress.premiumOwned) return false;
    return !claimed.has(reward.rewardId);
  });
}

/**
 * Record a reward as claimed. Idempotent: claiming an already-claimed `rewardId` returns an equivalent
 * progress without duplicating the id. Immutable — returns a new {@link PassProgress}.
 */
export function claimReward(progress: PassProgress, rewardId: string): PassProgress {
  if (progress.claimedRewardIds.includes(rewardId)) return progress;
  return {
    ...progress,
    claimedRewardIds: [...progress.claimedRewardIds, rewardId],
  };
}
