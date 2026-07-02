import { describe, it, expect } from 'vitest';
import { type PaymentWebhookEvent, type Entitlement, type RewardedAdGrant } from '@overworld/shared';
import { createPaymentProcessor } from './payments.js';
import { CATALOG } from './store.js';

function harness() {
  let t = 5_000_000;
  const applied: Array<{ entitlement: Entitlement; reversal: boolean }> = [];
  const proc = createPaymentProcessor({
    now: () => t,
    applyEntitlement: (entitlement, opts) => applied.push({ entitlement, reversal: opts.reversal }),
    catalog: CATALOG,
  });
  return { proc, applied, setNow: (v: number) => (t = v) };
}

function evt(overrides: Partial<PaymentWebhookEvent>): PaymentWebhookEvent {
  return {
    providerEventId: 'pe-1',
    playerId: 'player-1',
    sku: 'spark-pack-medium',
    amountCents: 499,
    status: 'succeeded',
    ts: 1000,
    ...overrides,
  };
}

describe('handleWebhook — sku → entitlement (P4-S-3b)', () => {
  it('grants sparks for a spark-pack purchase', () => {
    const { proc, applied } = harness();
    const res = proc.handleWebhook(evt({ sku: 'spark-pack-medium' }));

    expect(res.entitlement?.grantedSparks).toBe(500);
    expect(res.entitlement?.premiumPassGranted).toBe(false);
    expect(res.entitlement?.grantedCosmeticIds).toEqual([]);
    expect(res.entitlement?.ts).toBe(5_000_000);
    expect(applied).toHaveLength(1);
    expect(applied[0]?.reversal).toBe(false);
  });

  it('grants the premium pass flag for a premium-pass purchase', () => {
    const { proc } = harness();
    const res = proc.handleWebhook(evt({ sku: 'premium-pass-season', providerEventId: 'pe-2' }));
    expect(res.entitlement?.premiumPassGranted).toBe(true);
    expect(res.entitlement?.grantedSparks).toBe(0);
  });

  it('grants the bundle cosmetics for the Vanguard Kit', () => {
    const { proc } = harness();
    const res = proc.handleWebhook(evt({ sku: 'vanguard-kit', providerEventId: 'pe-3' }));
    expect(res.entitlement?.grantedCosmeticIds.length).toBeGreaterThan(1);
    expect(res.entitlement?.premiumPassGranted).toBe(false);
  });
});

describe('handleWebhook — verification & dedupe (P4-S-3a)', () => {
  it('dedupes a redelivered providerEventId with no double grant', () => {
    const { proc, applied } = harness();
    const first = proc.handleWebhook(evt({ providerEventId: 'dup' }));
    const second = proc.handleWebhook(evt({ providerEventId: 'dup' }));

    expect(first.entitlement).toBeDefined();
    expect(second.deduped).toBe(true);
    expect(second.entitlement).toBeUndefined();
    expect(applied).toHaveLength(1); // granted exactly once
  });

  it('ignores a failed charge and grants nothing', () => {
    const { proc, applied } = harness();
    const res = proc.handleWebhook(evt({ status: 'failed' }));
    expect(res.ignored).toBe(true);
    expect(res.entitlement).toBeUndefined();
    expect(applied).toHaveLength(0);
  });

  it('handles a refund as a reversal', () => {
    const { proc, applied } = harness();
    const res = proc.handleWebhook(evt({ status: 'refunded', providerEventId: 'refund-1' }));
    expect(res.reversal).toBe(true);
    expect(res.entitlement).toBeDefined();
    expect(applied[0]?.reversal).toBe(true);
  });

  it('ignores an unknown sku', () => {
    const { proc, applied } = harness();
    const res = proc.handleWebhook(evt({ sku: 'does-not-exist', providerEventId: 'unknown-1' }));
    expect(res.ignored).toBe(true);
    expect(applied).toHaveLength(0);
  });
});

describe('grantRewardedAd (P4-P-6)', () => {
  it('credits sparks only, never power', () => {
    const { proc } = harness();
    const grant: RewardedAdGrant = { playerId: 'player-1', adId: 'ad-9', sparkReward: 25, ts: 2000 };
    const credit = proc.grantRewardedAd(grant);

    expect(credit).toEqual({
      playerId: 'player-1',
      sparks: 25,
      reason: 'rewarded-ad',
      adId: 'ad-9',
      ts: 5_000_000,
    });
  });
});
