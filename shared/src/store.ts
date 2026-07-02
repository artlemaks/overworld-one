import { z } from 'zod';
import { CosmeticEffectKind } from './monetization.js';

/**
 * Store, bundles, payment & rewarded-ad contracts (P4-P-4 store / P4-P-5 Vanguard Kit / P4-P-6 ads /
 * P4-S-3a·b payments).
 *
 * The SINGLE SOURCE OF TRUTH for what can be bought and how entitlement is granted. Every purchasable is
 * cosmetic/status only — each store item declares a {@link CosmeticEffectKind}, so the P4-X-1 guardrail
 * validates the whole catalog is power-neutral. The payment layer is provider-AGNOSTIC on purpose: the
 * chosen provider (Stripe/Paddle, decided at the pre-P4 gate) plugs in behind {@link PaymentWebhookEvent}
 * and the server maps a verified webhook → entitlement grant (P4-S-3b). Real SDK keys live outside the
 * repo; these contracts + the server business logic are what's testable here (d-t3, p-t3 tests).
 *
 * Pure schemas; the entitlement/verification logic is server-side and DI'd.
 */

/** Price bands the store ships (USD cents), matching scope §8's $1.99–$6.99 range + the $9.99 bundle. */
export const PriceBand = z.enum(['b199', 'b399', 'b499', 'b699', 'b999']);
export type PriceBand = z.infer<typeof PriceBand>;

/** Map a price band to its amount in USD cents. */
export const PRICE_BAND_CENTS: Record<PriceBand, number> = {
  b199: 199,
  b399: 399,
  b499: 499,
  b699: 699,
  b999: 999,
};

/** What a purchase delivers: cosmetics, a spark pack, the premium pass, or the Vanguard bundle. */
export const StoreItemKind = z.enum(['cosmetic', 'spark-pack', 'premium-pass', 'vanguard-kit']);
export type StoreItemKind = z.infer<typeof StoreItemKind>;

/** One purchasable store entry. Cosmetic entries carry an `effectKind` so the guardrail can validate them. */
export const StoreItem = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  kind: StoreItemKind,
  priceBand: PriceBand,
  /** For cosmetic/bundle entries: the cosmetic effect kind (must be on the power-neutral allowlist). */
  effectKind: CosmeticEffectKind.nullable().default(null),
  /** For spark-pack entries: how many sparks are credited on purchase. */
  sparkAmount: z.number().int().nonnegative().default(0),
  /** cosmeticIds granted on purchase (bundles grant several). */
  grantsCosmeticIds: z.array(z.string()).default([]),
});
export type StoreItem = z.infer<typeof StoreItem>;

/**
 * A verified payment webhook from the chosen provider (P4-S-3a). The server never trusts the client for
 * entitlement — it acts only on a provider-verified webhook. `providerEventId` dedupes retries.
 */
export const PaymentWebhookEvent = z.object({
  providerEventId: z.string().min(1),
  playerId: z.string().min(1),
  sku: z.string().min(1),
  amountCents: z.number().int().nonnegative(),
  status: z.enum(['succeeded', 'refunded', 'failed']),
  ts: z.number().int().nonnegative(),
});
export type PaymentWebhookEvent = z.infer<typeof PaymentWebhookEvent>;

/** The entitlement a successful purchase grants — what the server applies to the player. */
export const Entitlement = z.object({
  playerId: z.string().min(1),
  sku: z.string().min(1),
  grantedCosmeticIds: z.array(z.string()),
  grantedSparks: z.number().int().nonnegative(),
  premiumPassGranted: z.boolean(),
  ts: z.number().int().nonnegative(),
});
export type Entitlement = z.infer<typeof Entitlement>;

/** A rewarded-ad grant (P4-P-6). Opt-in; tops up sparks or a visual-only boost skin — never power. */
export const RewardedAdGrant = z.object({
  playerId: z.string().min(1),
  adId: z.string().min(1),
  sparkReward: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
});
export type RewardedAdGrant = z.infer<typeof RewardedAdGrant>;
