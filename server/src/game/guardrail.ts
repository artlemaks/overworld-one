import {
  capHeatMultiplier,
  isCosmeticPowerNeutral,
  type PowerEffect,
  type StoreItem,
} from '@overworld/shared';

/**
 * ENFORCED monetization guardrail (P4-X-1 / OOM).
 *
 * This is the server-side enforcement point for the brand-critical, provably non-pay-to-win invariant
 * (scope §8): **nothing a player buys may raise their contribution/heat multiplier, XP rate, or move the
 * global tally.** {@link ../../../shared/src/monetization.ts | shared/monetization} is the single source
 * of truth for the cap and the cosmetic allowlist; this module *composes* those primitives at the exact
 * seam where the server would otherwise be tempted to fold a "purchased bonus" into heat, and proves it
 * cannot (indications `monetization-never-pay-to-win`, `enforce-non-p2w-guardrail`).
 *
 * Pure and deterministic — no clock, no random, no I/O — so the P4-X-1 e2e guardrail is fully unit-testable.
 */

/** Combo length at which the combo term is fully earned (1.0). Purely a skill signal. */
const COMBO_SATURATION = 8;

/** Clamp any signal into the [0,1] factor range, treating non-finite input as 0 (never NaN out). */
const clamp01 = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
};

/** The LEGITIMATE skill inputs the enforced heat multiplier is allowed to read. */
export interface HeatMultiplierInputs {
  /** Current combo/streak length (>= 0). Normalised against {@link COMBO_SATURATION}. */
  combo: number;
  /** Per-action role affinity in [0,1] (P3). */
  roleAffinity: number;
  /**
   * A bonus a purchase *claims* it should grant. Passed only so callers/tests can PROVE it is ignored —
   * this function never reads it (purchases never feed heat). See the assertion in the e2e guardrail.
   */
  purchasedBonusClaimed?: number;
}

/**
 * The enforced heat/contribution multiplier from LEGITIMATE inputs only, hard-capped by the shared
 * {@link capHeatMultiplier} so the result is ALWAYS <= 1.0 (`HEAT_MULTIPLIER_CAP`).
 *
 * The two skill terms are blended *additively* — their sum can transiently exceed 1.0 — precisely so the
 * shared cap is doing real, observable work as the final total step, not a no-op. Critically,
 * `inputs.purchasedBonusClaimed` is intentionally NOT read: even a caller injecting an enormous purchased
 * bonus cannot lift the output above the cap, which is the whole point of the guardrail.
 */
export function enforcedHeatMultiplier(inputs: HeatMultiplierInputs): number {
  const comboFactor = clamp01(inputs.combo / COMBO_SATURATION);
  const affinityFactor = clamp01(inputs.roleAffinity);
  // NOTE: inputs.purchasedBonusClaimed is deliberately absent from this computation.
  const raw = comboFactor + affinityFactor;
  return capHeatMultiplier(raw);
}

/**
 * Assert that every item in a store catalog is power-neutral (P4-X-1 DoD). Throws on the first item that
 * fails the shared {@link isCosmeticPowerNeutral} check, naming the offending sku.
 *
 * Non-cosmetic entries (spark packs, the premium pass) carry a `null` {@link StoreItem.effectKind} and no
 * power claim, so they are inherently neutral and skipped; only cosmetic-bearing entries are run through
 * the allowlist. A `power` field is not part of the {@link StoreItem} contract, but if one is smuggled in
 * it is read defensively and rejected — an allowlist, not a denylist, is the whole design.
 */
export function assertCatalogNoPower(catalog: StoreItem[]): void {
  for (const item of catalog) {
    if (item.effectKind === null) continue;
    const power = (item as { power?: Partial<PowerEffect> }).power;
    if (!isCosmeticPowerNeutral({ effectKind: item.effectKind, power })) {
      throw new Error(
        `Catalog item "${item.sku}" is not power-neutral (P4-X-1 non-pay-to-win guardrail violation)`,
      );
    }
  }
}

/**
 * A minimal snapshot of everything a purchase is FORBIDDEN to influence: the player's heat multiplier,
 * their XP rate, and the shared global tally. Used by the P4-X-1 e2e to compare before/after a purchase.
 */
export interface OutcomeSnapshot {
  /** The enforced heat/contribution multiplier (<= 1.0). */
  heatMultiplier: number;
  /** The player's XP accrual rate (free and premium curves must be identical). */
  xpRate: number;
  /** The global contribution tally the run is driving toward. */
  globalTally: number;
}

/**
 * True iff any outcome-relevant value changed between `before` and `after` a purchase. The guardrail e2e
 * asserts this is ALWAYS false: buying premium/bundle/sparks must move none of heat, XP, or tally.
 */
export function purchaseAffectsOutcome(before: OutcomeSnapshot, after: OutcomeSnapshot): boolean {
  return (
    before.heatMultiplier !== after.heatMultiplier ||
    before.xpRate !== after.xpRate ||
    before.globalTally !== after.globalTally
  );
}
