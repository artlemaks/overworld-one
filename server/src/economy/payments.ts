import {
  type PaymentWebhookEvent,
  type Entitlement,
  type RewardedAdGrant,
  type StoreItem,
} from '@overworld/shared';
import { findSku } from './store.js';

/**
 * Provider-agnostic payment business logic (P4-S-3a verify/dedupe / P4-S-3b sku → entitlement).
 *
 * The server NEVER trusts the client for entitlement and NEVER calls a real provider SDK here — it acts
 * only on a {@link PaymentWebhookEvent} that the transport layer has already verified against the chosen
 * provider (Stripe/Paddle, decided at the pre-P4 gate). This module is the pure decision core:
 *  - it ignores non-successful webhooks (`failed`), flags `refunded` as a reversal,
 *  - dedupes retries by `providerEventId` so a redelivered webhook grants nothing twice,
 *  - maps a `succeeded` webhook's `sku` → {@link Entitlement} from the catalog, and hands that entitlement
 *    to the injected `applyEntitlement` sink (persistence lives outside; this stays unit-testable).
 *
 * Rewarded ads (P4-P-6) are opt-in and credit sparks only — {@link grantRewardedAd} can never emit power.
 *
 * Pure/DI: inject `now` (epoch ms) and `applyEntitlement`; no `Date.now()`, no `Math.random()`, no I/O.
 */

export interface PaymentProcessorDeps {
  /** Injectable clock (epoch ms) — stamps the entitlement/reversal. */
  now: () => number;
  /** Sink that durably applies a granted entitlement (or its reversal on refund). DI'd for testability. */
  applyEntitlement: (entitlement: Entitlement, opts: { reversal: boolean }) => void;
  /** The catalog the webhook `sku` is resolved against. */
  catalog: readonly StoreItem[];
}

/** The outcome of handling one webhook. Exactly one of the flags/entitlement describes what happened. */
export interface WebhookResult {
  /** The mapped entitlement, when a `succeeded`/`refunded` webhook resolved to a catalog item. */
  entitlement?: Entitlement;
  /** True when this `providerEventId` was already processed — no grant applied. */
  deduped?: boolean;
  /** True when the webhook was intentionally ignored (`failed`, or an unknown sku). */
  ignored?: boolean;
  /** True when the webhook reverses a prior grant (`refunded`). */
  reversal?: boolean;
}

/** A spark-credit instruction from a rewarded ad — visual/economy currency only, never power. */
export interface SparkCredit {
  playerId: string;
  sparks: number;
  reason: 'rewarded-ad';
  adId: string;
  ts: number;
}

export interface PaymentProcessor {
  /** Handle one verified provider webhook (P4-S-3a/b). Idempotent on `providerEventId`. */
  handleWebhook(evt: PaymentWebhookEvent): WebhookResult;
  /** Convert a rewarded-ad grant into a spark credit (P4-P-6). Sparks only — never power. */
  grantRewardedAd(grant: RewardedAdGrant): SparkCredit;
}

/** Map a resolved catalog item → the entitlement it grants a player. Pure translation, no side effects. */
function entitlementFor(item: StoreItem, evt: PaymentWebhookEvent, ts: number): Entitlement {
  return {
    playerId: evt.playerId,
    sku: item.sku,
    grantedCosmeticIds: [...item.grantsCosmeticIds],
    grantedSparks: item.sparkAmount,
    premiumPassGranted: item.kind === 'premium-pass',
    ts,
  };
}

export function createPaymentProcessor(deps: PaymentProcessorDeps): PaymentProcessor {
  // Dedupe ledger: a redelivered webhook (same providerEventId) must never double-grant (P4-S-3a).
  const processed = new Set<string>();

  return {
    handleWebhook(evt: PaymentWebhookEvent): WebhookResult {
      // A `failed` charge grants nothing — ignore before touching the dedupe ledger so a later retry that
      // flips to `succeeded` (same provider event id is not reused across statuses in practice) is unaffected.
      if (evt.status === 'failed') {
        return { ignored: true };
      }

      // Idempotency guard: once we've acted on this provider event id, any redelivery is a no-op grant.
      if (processed.has(evt.providerEventId)) {
        return { deduped: true };
      }

      const item = findSku(deps.catalog, evt.sku);
      if (item === undefined) {
        // Unknown sku — mark processed so retries of a bad event don't spin, but grant nothing.
        processed.add(evt.providerEventId);
        return { ignored: true };
      }

      const ts = deps.now();
      const entitlement = entitlementFor(item, evt, ts);
      const reversal = evt.status === 'refunded';

      processed.add(evt.providerEventId);
      deps.applyEntitlement(entitlement, { reversal });

      const result: WebhookResult = { entitlement };
      if (reversal) result.reversal = true;
      return result;
    },

    grantRewardedAd(grant: RewardedAdGrant): SparkCredit {
      // Rewarded ads are opt-in and cosmetic-economy only: they top up sparks, never a power multiplier.
      return {
        playerId: grant.playerId,
        sparks: grant.sparkReward,
        reason: 'rewarded-ad',
        adId: grant.adId,
        ts: deps.now(),
      };
    },
  };
}
