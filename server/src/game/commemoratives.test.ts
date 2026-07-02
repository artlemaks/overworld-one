import { describe, it, expect } from 'vitest';
import {
  buildCommemorative,
  rarityFor,
  isExpired,
  DEFAULT_COMMEMORATIVE_CONFIG,
  type CommemorativeParams,
} from './commemoratives.js';

const params = (over: Partial<CommemorativeParams> = {}): CommemorativeParams => ({
  eventId: 'evt-1',
  playerId: 'p1',
  tier: 'gold',
  outcome: 'completed',
  earnedAtTs: 1_000_000,
  ...over,
});

describe('commemorative rarity', () => {
  it('maps tier to rarity on a win', () => {
    expect(rarityFor('legendary', 'completed')).toBe('legendary');
    expect(rarityFor('gold', 'completed')).toBe('epic');
    expect(rarityFor('silver', 'completed')).toBe('rare');
    expect(rarityFor('bronze', 'completed')).toBe('common');
  });

  it('grants nothing to the none tier', () => {
    expect(rarityFor('none', 'completed')).toBeNull();
  });

  it('downgrades one notch on a failed event', () => {
    expect(rarityFor('legendary', 'failed')).toBe('epic');
    expect(rarityFor('bronze', 'failed')).toBe('common'); // floor
  });
});

describe('buildCommemorative', () => {
  it('returns null for a non-qualifying tier', () => {
    expect(buildCommemorative(params({ tier: 'none' }))).toBeNull();
  });

  it('sets an event-scoped expiry for a non-permanent rarity (FOMO)', () => {
    const c = buildCommemorative(params({ tier: 'gold' }))!; // epic -> 90d ttl
    const ttl = DEFAULT_COMMEMORATIVE_CONFIG.ttlMsByRarity.epic!;
    expect(c.rarity).toBe('epic');
    expect(c.expiresAtTs).toBe(1_000_000 + ttl);
  });

  it('makes legendaries permanent (no expiry)', () => {
    const c = buildCommemorative(params({ tier: 'legendary' }))!;
    expect(c.rarity).toBe('legendary');
    expect(c.expiresAtTs).toBeNull();
  });

  it('derives a deterministic id so re-grant is idempotent', () => {
    expect(buildCommemorative(params())?.commemorativeId).toBe('evt-1:p1');
  });
});

describe('isExpired', () => {
  it('lapses a badge once past its expiry', () => {
    const c = buildCommemorative(params({ tier: 'bronze' }))!; // common -> 7d
    expect(isExpired(c, c.expiresAtTs! - 1)).toBe(false);
    expect(isExpired(c, c.expiresAtTs!)).toBe(true);
  });

  it('never lapses a permanent badge', () => {
    const c = buildCommemorative(params({ tier: 'legendary' }))!;
    expect(isExpired(c, Number.MAX_SAFE_INTEGER)).toBe(false);
  });
});
