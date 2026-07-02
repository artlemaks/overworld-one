import { describe, it, expect } from 'vitest';
import { HEAT_MULTIPLIER_CAP, type StoreItem } from '@overworld/shared';
import {
  enforcedHeatMultiplier,
  assertCatalogNoPower,
  purchaseAffectsOutcome,
  type OutcomeSnapshot,
} from './guardrail.js';

/** A clean, power-neutral cosmetic catalog entry. */
const cosmetic = (over: Partial<StoreItem> = {}): StoreItem => ({
  sku: 'cos.avatar.viking',
  name: 'Viking Avatar',
  kind: 'cosmetic',
  priceBand: 'b199',
  effectKind: 'avatar',
  sparkAmount: 0,
  grantsCosmeticIds: ['avatar.viking'],
  ...over,
});

/** A non-cosmetic entry (spark pack / premium pass) — effectKind is null, inherently neutral. */
const sparkPack = (over: Partial<StoreItem> = {}): StoreItem => ({
  sku: 'sparks.small',
  name: 'Small Spark Pack',
  kind: 'spark-pack',
  priceBand: 'b199',
  effectKind: null,
  sparkAmount: 100,
  grantsCosmeticIds: [],
  ...over,
});

describe('P4-X-1 enforced heat multiplier', () => {
  it('never exceeds the 1.0 cap for legitimate inputs', () => {
    expect(enforcedHeatMultiplier({ combo: 8, roleAffinity: 1 })).toBe(HEAT_MULTIPLIER_CAP);
    expect(enforcedHeatMultiplier({ combo: 4, roleAffinity: 0.25 })).toBeLessThanOrEqual(
      HEAT_MULTIPLIER_CAP,
    );
    expect(enforcedHeatMultiplier({ combo: 0, roleAffinity: 0 })).toBe(0);
  });

  it('caps even when the raw legitimate blend would exceed 1.0', () => {
    // combo saturates (>=8) and full affinity → additive raw of 2.0, hard-capped to 1.0.
    expect(enforcedHeatMultiplier({ combo: 100, roleAffinity: 5 })).toBe(1.0);
  });

  it('NEVER exceeds 1.0 even with a huge injected purchasedBonusClaimed (the proof)', () => {
    const withoutBonus = enforcedHeatMultiplier({ combo: 3, roleAffinity: 0.2 });
    const withHugeBonus = enforcedHeatMultiplier({
      combo: 3,
      roleAffinity: 0.2,
      purchasedBonusClaimed: 1_000_000,
    });
    // Purchases never feed heat: the injected bonus is ignored, so the result is byte-identical…
    expect(withHugeBonus).toBe(withoutBonus);
    // …and unconditionally under the cap.
    expect(withHugeBonus).toBeLessThanOrEqual(HEAT_MULTIPLIER_CAP);
    // Even paired with max legit inputs, a giant purchased bonus cannot break the cap.
    expect(
      enforcedHeatMultiplier({ combo: 999, roleAffinity: 999, purchasedBonusClaimed: 1e9 }),
    ).toBe(HEAT_MULTIPLIER_CAP);
  });

  it('treats non-finite / negative signals as zero (never NaN)', () => {
    expect(enforcedHeatMultiplier({ combo: Number.NaN, roleAffinity: Number.POSITIVE_INFINITY })).toBe(
      0,
    );
    expect(enforcedHeatMultiplier({ combo: -50, roleAffinity: -1 })).toBe(0);
  });
});

describe('P4-X-1 assertCatalogNoPower', () => {
  it('passes a clean, power-neutral catalog (cosmetics + spark pack)', () => {
    const clean: StoreItem[] = [
      cosmetic(),
      cosmetic({ sku: 'cos.vfx.flame', effectKind: 'strike-vfx' }),
      cosmetic({ sku: 'cos.badge.founder', effectKind: 'badge' }),
      sparkPack(),
    ];
    expect(() => assertCatalogNoPower(clean)).not.toThrow();
  });

  it('throws on an item with a non-cosmetic (power-affecting) effect kind', () => {
    const poisoned: StoreItem[] = [
      cosmetic(),
      // A catalog entry sneaking in a non-allowlisted effect kind (would need a runtime bypass).
      cosmetic({ sku: 'cos.evil.buff', effectKind: 'weapon-buff' as unknown as StoreItem['effectKind'] }),
    ];
    expect(() => assertCatalogNoPower(poisoned)).toThrow(/cos\.evil\.buff/);
  });

  it('throws on an item smuggling a non-zero power effect', () => {
    const poisoned = [
      cosmetic(),
      { ...cosmetic({ sku: 'cos.pay2win' }), power: { heatMultiplierBonus: 0.5 } },
    ] as StoreItem[];
    expect(() => assertCatalogNoPower(poisoned)).toThrow(/cos\.pay2win/);
  });
});

describe('P4-X-1 purchaseAffectsOutcome', () => {
  const snap: OutcomeSnapshot = { heatMultiplier: 1.0, xpRate: 12, globalTally: 5000 };

  it('is false when a purchase changes nothing (premium/bundle/sparks bought)', () => {
    // Simulate buying premium pass, the vanguard bundle, and a spark pack: outcome snapshot is unmoved.
    const before = { ...snap };
    const afterPremium = { ...snap };
    const afterBundle = { ...snap };
    const afterSparks = { ...snap };
    expect(purchaseAffectsOutcome(before, afterPremium)).toBe(false);
    expect(purchaseAffectsOutcome(before, afterBundle)).toBe(false);
    expect(purchaseAffectsOutcome(before, afterSparks)).toBe(false);
  });

  it('detects any change (guards the guardrail itself)', () => {
    expect(purchaseAffectsOutcome(snap, { ...snap, heatMultiplier: 1.01 })).toBe(true);
    expect(purchaseAffectsOutcome(snap, { ...snap, xpRate: 13 })).toBe(true);
    expect(purchaseAffectsOutcome(snap, { ...snap, globalTally: 5001 })).toBe(true);
  });
});
