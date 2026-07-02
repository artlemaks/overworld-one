import { describe, it, expect } from 'vitest';
import { type StoreItem, PRICE_BAND_CENTS } from '@overworld/shared';
import { CATALOG, validateCatalogPowerNeutral, findSku } from './store.js';

describe('CATALOG', () => {
  it('ships the required item kinds', () => {
    const kinds = new Set(CATALOG.map((i) => i.kind));
    expect(kinds).toEqual(new Set(['cosmetic', 'spark-pack', 'premium-pass', 'vanguard-kit']));

    const sparkPack = CATALOG.find((i) => i.kind === 'spark-pack')!;
    expect(sparkPack.sparkAmount).toBeGreaterThan(0);

    const kit = CATALOG.find((i) => i.kind === 'vanguard-kit')!;
    expect(kit.grantsCosmeticIds.length).toBeGreaterThan(0);
  });

  it('passes the P4-X-1 power-neutrality guardrail', () => {
    const { ok, offenders } = validateCatalogPowerNeutral(CATALOG);
    expect(offenders).toEqual([]);
    expect(ok).toBe(true);
  });

  it('prices every entry from a real shared price band', () => {
    for (const item of CATALOG) {
      expect(PRICE_BAND_CENTS[item.priceBand]).toBeGreaterThan(0);
    }
    // Spot-check the band → cents mapping is the shared source of truth.
    const kit = findSku(CATALOG, 'vanguard-kit')!;
    expect(kit.priceBand).toBe('b999');
    expect(PRICE_BAND_CENTS[kit.priceBand]).toBe(999);
  });
});

describe('validateCatalogPowerNeutral', () => {
  it('flags a deliberately-poisoned cosmetic as an offender', () => {
    // A cosmetic entry masquerading with a non-cosmetic effect kind must be rejected.
    const poisoned = {
      sku: 'cheat-boots',
      name: 'Pay-to-Win Boots',
      kind: 'cosmetic',
      priceBand: 'b199',
      // Not on the cosmetic allowlist → power-affecting by default.
      effectKind: 'heat-boost' as unknown as StoreItem['effectKind'],
      sparkAmount: 0,
      grantsCosmeticIds: ['boots.cheat'],
    } as StoreItem;

    const { ok, offenders } = validateCatalogPowerNeutral([...CATALOG, poisoned]);
    expect(ok).toBe(false);
    expect(offenders).toContain('cheat-boots');
  });

  it('flags a cosmetic/bundle entry with no effect kind', () => {
    const noEffect = {
      sku: 'mystery-cosmetic',
      name: 'Mystery Cosmetic',
      kind: 'cosmetic',
      priceBand: 'b199',
      effectKind: null,
      sparkAmount: 0,
      grantsCosmeticIds: [],
    } as StoreItem;

    const { ok, offenders } = validateCatalogPowerNeutral([noEffect]);
    expect(ok).toBe(false);
    expect(offenders).toEqual(['mystery-cosmetic']);
  });
});

describe('findSku', () => {
  it('resolves a known sku and misses an unknown one', () => {
    expect(findSku(CATALOG, 'premium-pass-season')?.kind).toBe('premium-pass');
    expect(findSku(CATALOG, 'nope')).toBeUndefined();
  });
});
