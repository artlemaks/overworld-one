import { z } from 'zod';

/**
 * Event / season pass contracts (P4-P-3 / OOM).
 *
 * The SINGLE SOURCE OF TRUTH for the pass: two lanes (free + premium) that share ONE XP→tier curve.
 * The brand-critical rule (scope §8) is baked into the shape: **the free and premium XP curves are
 * provably identical.** Premium does not progress faster — it only unlocks *cosmetic/commemorative*
 * rewards at tiers the free player also reaches (indication `monetization-never-pay-to-win`). The tier
 * function {@link passTierForXp} is used for BOTH lanes; there is deliberately no premium variant of it.
 *
 * Pure; reconciled from XP at resolution (p-t1 test asserts curve identity). No clock/I/O.
 */

/** XP required to *complete* each successive tier. Index 0 = XP to finish tier 1, etc. */
export const TIER_XP_THRESHOLDS: readonly number[] = [
  0, 100, 250, 450, 700, 1000, 1350, 1750, 2200, 2700,
];

/** The highest tier obtainable (length of the threshold table). */
export const MAX_PASS_TIER = TIER_XP_THRESHOLDS.length;

/**
 * The pass tier a given cumulative XP has reached (0..MAX_PASS_TIER). IDENTICAL for free and premium —
 * this single function is the proof that premium never buys faster progression. Monotonic in xp.
 */
export function passTierForXp(xp: number): number {
  const x = Math.max(0, xp);
  let tier = 0;
  for (let i = 0; i < TIER_XP_THRESHOLDS.length; i++) {
    // index guarded by loop bound
    if (x >= (TIER_XP_THRESHOLDS[i] as number)) tier = i;
    else break;
  }
  return tier;
}

/** Which lane a reward sits on. Free rewards are earned by all; premium require the paid pass. */
export const PassLane = z.enum(['free', 'premium']);
export type PassLane = z.infer<typeof PassLane>;

/** One reward slot on the pass track, at a given tier + lane. Rewards are cosmetic/commemorative only. */
export const PassReward = z.object({
  tier: z.number().int().positive(),
  lane: PassLane,
  /** Cosmetic/commemorative id granted at this tier; never a power item. */
  rewardId: z.string().min(1),
  label: z.string().min(1),
});
export type PassReward = z.infer<typeof PassReward>;

/** A player's pass state, reconciled from XP at resolution. `premiumOwned` gates the premium lane only. */
export const PassProgress = z.object({
  playerId: z.string().min(1),
  seasonId: z.string().min(1),
  xp: z.number().int().nonnegative(),
  tier: z.number().int().nonnegative(),
  premiumOwned: z.boolean(),
  /** rewardIds already claimed (idempotent claim). */
  claimedRewardIds: z.array(z.string()),
});
export type PassProgress = z.infer<typeof PassProgress>;
