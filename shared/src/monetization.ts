import { z } from 'zod';

/**
 * Monetization fairness guardrail — the ENFORCED, provably non-pay-to-win core (P4-X-1 / OOM).
 *
 * This is the brand-critical invariant of the whole game (scope §8): **nothing a player buys — premium
 * pass, bundle, sparks, ad boost — may increase their contribution/heat multiplier or their XP rate.**
 * Purchases buy *cosmetics and status only*. This module is the single source of truth for that rule so
 * the server, the pass engine, and the store all enforce the exact same cap, and the P4-X-1 e2e guardrail
 * test asserts against these constants (indications `monetization-never-pay-to-win`,
 * `contracts-single-source-of-truth`).
 *
 * The mechanism is deliberately blunt and total: the backend contribution/heat multiplier is
 * hard-capped at {@link HEAT_MULTIPLIER_CAP} = 1.0 REGARDLESS of pass tier or purchases, and every
 * cosmetic must pass {@link isCosmeticPowerNeutral}. Pure; no clock/I/O.
 */

/** The absolute cap on any player's aggregate contribution/heat multiplier. Buying cannot exceed 1.0×. */
export const HEAT_MULTIPLIER_CAP = 1.0;

/**
 * Clamp any computed heat/contribution multiplier to the fairness cap. The server calls this as the LAST
 * step before applying a multiplier, so no upstream bonus (role affinity, combo, or — critically — any
 * purchase) can ever push a player above 1.0× aggregate. Role affinity (P3) is expressed per-action and
 * still nets out ≤1.0× aggregate; this is the belt-and-braces enforcement point.
 */
export function capHeatMultiplier(multiplier: number): number {
  return Math.min(HEAT_MULTIPLIER_CAP, Math.max(0, multiplier));
}

/**
 * The kinds of effect a catalog item is allowed to have. Anything outside this set is power-affecting
 * and MUST be rejected by {@link isCosmeticPowerNeutral}. Kept as an allowlist (not a denylist) so a new
 * item type is power-affecting by default until explicitly proven cosmetic.
 */
export const CosmeticEffectKind = z.enum([
  'avatar', // visual character
  'strike-vfx', // contribution visual effect
  'emote', // cheer emote
  'badge', // profile badge
  'name-flair', // decorative name styling
  'profile-frame', // profile chrome
  'album-slot', // commemorative album capacity (status, not power)
]);
export type CosmeticEffectKind = z.infer<typeof CosmeticEffectKind>;

/**
 * A power-relevant claim an item might make. If an item asserts ANY of these, it is pay-to-win and the
 * validator rejects it. This is the machine-checkable definition the guardrail test relies on.
 */
export const PowerEffect = z.object({
  /** Any non-zero heat/contribution multiplier bonus is forbidden. */
  heatMultiplierBonus: z.number().default(0),
  /** Any XP-rate bonus is forbidden (free/premium XP curves must be identical). */
  xpRateBonus: z.number().default(0),
  /** Any contribution-value bonus is forbidden. */
  contributionValueBonus: z.number().default(0),
});
export type PowerEffect = z.infer<typeof PowerEffect>;

/**
 * True iff an item is power-neutral: its effect kind is on the cosmetic allowlist AND it declares no
 * non-zero power effect. The store/catalog validation (P4-X-1 DoD) runs this over every item; the
 * guardrail e2e asserts the whole catalog passes.
 */
export function isCosmeticPowerNeutral(item: {
  effectKind: CosmeticEffectKind;
  power?: Partial<PowerEffect>;
}): boolean {
  const p = item.power ?? {};
  const noPower =
    (p.heatMultiplierBonus ?? 0) === 0 &&
    (p.xpRateBonus ?? 0) === 0 &&
    (p.contributionValueBonus ?? 0) === 0;
  return CosmeticEffectKind.safeParse(item.effectKind).success && noPower;
}
