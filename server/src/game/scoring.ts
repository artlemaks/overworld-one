import type { ActionType, ContributionMessage } from '@overworld/shared';

/**
 * Server-authoritative contribution scoring (P1-S-3 / OOM-27).
 *
 * **The server owns the number.** A {@link ContributionMessage} carries only *skill signals* in its
 * opaque `inputParams` bag (aim, timing) — never a score. This module recomputes the point value from
 * those signals using server-side constants the client cannot influence. It deliberately ignores any
 * convenience field a client might pack (e.g. a pre-summarised `accuracy`), because a cheating client
 * could pin that to 1.0; only the primitive `aimAccuracy`/`timingQuality` signals feed the formula,
 * and both are clamped to [0,1] first (value-inflation defence, paired with `anticheat.ts`).
 *
 * **Non-pay-to-win guardrail (indication `enforce-non-p2w-guardrail`).** There is exactly one skill
 * term and it is bounded by {@link POWER_MULTIPLIER_CAP} = 1.0. No pass tier, purchase, or cosmetic
 * may ever push effective points above the pure-skill value — the P4 monetization guardrail's 1.0×
 * hard cap starts here, at the only place points are minted.
 *
 * Pure and deterministic (no clock, no random) → fully unit-testable in Node.
 */

/** Hard ceiling on any effectiveness multiplier, forever. Purchases/pass tiers may never exceed it. */
export const POWER_MULTIPLIER_CAP = 1.0;

/** Base points a flawless contribution of each action type is worth. */
export const ACTION_BASE_POINTS: Record<ActionType, number> = {
  strike: 100,
  support: 70,
  rally: 50,
};

/** How the two skill signals combine into the [0,1] effectiveness factor. Must sum to 1. */
const AIM_WEIGHT = 0.6;
const TIMING_WEIGHT = 0.4;

const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
};

/**
 * The pure [0,1] skill factor for a contribution, from its clamped aim + timing signals. Capped at
 * {@link POWER_MULTIPLIER_CAP} so this value can never exceed 1.0 no matter what downstream systems do.
 */
export function skillFactor(msg: ContributionMessage): number {
  const aim = clamp01(msg.inputParams.aimAccuracy ?? 0);
  const timing = clamp01(msg.inputParams.timingQuality ?? 0);
  const factor = AIM_WEIGHT * aim + TIMING_WEIGHT * timing;
  return Math.min(POWER_MULTIPLIER_CAP, factor);
}

/**
 * Authoritative points for a contribution: base for its action type, scaled by the pure skill factor,
 * rounded to a whole number. This is the value that mutates the counter and is echoed to the client
 * for reconciliation — the client's own guess is discarded.
 */
export function computeContributionPoints(msg: ContributionMessage): number {
  const base = ACTION_BASE_POINTS[msg.actionType];
  return Math.round(base * skillFactor(msg));
}
