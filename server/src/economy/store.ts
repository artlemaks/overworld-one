import {
  type StoreItem,
  isCosmeticPowerNeutral,
  PRICE_BAND_CENTS,
} from '@overworld/shared';

/**
 * Store catalog + fairness validation (P4-P-4 store / P4-P-5 Vanguard Kit / P4-P-6 ads → spark packs /
 * P4-X-1 catalog guardrail).
 *
 * The server-side, shippable catalog of purchasables and the pure check that proves the whole catalog is
 * power-neutral. Every entry is cosmetic/status/currency only — there is deliberately NOTHING here that a
 * player could buy to raise their contribution/heat multiplier or XP rate (scope §8's brand-critical
 * non-pay-to-win invariant). The {@link CATALOG} is the single source of truth the payment layer
 * (`payments.ts`) reads to map a verified webhook `sku` → entitlement.
 *
 * Pure: no clock, no I/O, no provider SDK. The catalog is a static constant; validation is a fold over it.
 */

/**
 * The shipped store catalog (P4-P-4/5/6). Price bands come from shared {@link PRICE_BAND_CENTS} so the
 * displayed cents can never drift from the amount the provider actually charges.
 *
 * Invariants enforced by {@link validateCatalogPowerNeutral} (asserted by the P4-X-1 e2e + store.test):
 *  - every `cosmetic`/`vanguard-kit` entry declares a power-neutral `effectKind` and no power fields;
 *  - `spark-pack` entries credit sparks (visual/economy currency), never power;
 *  - `premium-pass` unlocks cosmetic tracks only — the pass engine hard-caps heat at 1.0× regardless.
 */
export const CATALOG: readonly StoreItem[] = [
  {
    sku: 'cos-avatar-vanguard',
    name: 'Vanguard Avatar',
    kind: 'cosmetic',
    priceBand: 'b199',
    effectKind: 'avatar',
    sparkAmount: 0,
    grantsCosmeticIds: ['avatar.vanguard'],
  },
  {
    sku: 'spark-pack-medium',
    name: 'Spark Pack',
    kind: 'spark-pack',
    priceBand: 'b499',
    effectKind: null,
    sparkAmount: 500,
    grantsCosmeticIds: [],
  },
  {
    sku: 'premium-pass-season',
    name: 'Premium Pass',
    kind: 'premium-pass',
    priceBand: 'b699',
    effectKind: null,
    sparkAmount: 0,
    grantsCosmeticIds: [],
  },
  {
    sku: 'vanguard-kit',
    name: 'Vanguard Kit',
    kind: 'vanguard-kit',
    priceBand: 'b999',
    effectKind: 'avatar',
    sparkAmount: 0,
    grantsCosmeticIds: ['avatar.vanguard', 'strike-vfx.vanguard', 'profile-frame.vanguard', 'badge.vanguard'],
  },
];

/** Kinds whose power-neutrality the guardrail must verify (they carry a cosmetic `effectKind`). */
const COSMETIC_KINDS: ReadonlySet<StoreItem['kind']> = new Set(['cosmetic', 'vanguard-kit']);

/**
 * Validate that every cosmetic/bundle entry in the catalog is power-neutral (P4-X-1 catalog check).
 *
 * Runs the shared {@link isCosmeticPowerNeutral} over each `cosmetic`/`vanguard-kit` entry — the allowlist
 * check that rejects any item asserting a heat/XP/contribution bonus. Returns the offending SKUs so a
 * failing build points straight at the poisoned item. `ok` is true iff there are no offenders.
 */
export function validateCatalogPowerNeutral(
  catalog: readonly StoreItem[],
): { ok: boolean; offenders: string[] } {
  const offenders: string[] = [];
  for (const item of catalog) {
    if (!COSMETIC_KINDS.has(item.kind)) continue;
    // A cosmetic/bundle entry with no effectKind cannot be proven power-neutral → treat as an offender.
    if (item.effectKind === null) {
      offenders.push(item.sku);
      continue;
    }
    if (!isCosmeticPowerNeutral({ effectKind: item.effectKind })) {
      offenders.push(item.sku);
    }
  }
  return { ok: offenders.length === 0, offenders };
}

/** Look up a catalog entry by SKU (the payment layer resolves a webhook's `sku` through this). */
export function findSku(
  catalog: readonly StoreItem[],
  sku: string,
): StoreItem | undefined {
  return catalog.find((item) => item.sku === sku);
}

/** Re-export for callers pricing a band without reaching into shared directly. */
export { PRICE_BAND_CENTS };
