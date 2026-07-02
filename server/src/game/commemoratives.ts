import type { Tier, CommemorativeRarity, EventOutcome, Commemorative } from '@overworld/shared';

/**
 * Commemoratives — time-limited rarity badges (P2-P-1 / OOM-45).
 *
 * At resolution each qualifying participant earns a commemorative whose **rarity** follows their tier
 * (and is knocked down a notch if the event *failed* — a defeat trophy is worth less than a victory
 * one) and whose **expiry** encodes the FOMO mechanic: most badges visibly lapse after an
 * event-scoped TTL, while the rarest are permanent keepsakes (`expiresAtTs = null`).
 *
 * Pure and deterministic — the id is derived from `(eventId, playerId)` so re-running resolution grants
 * the *same* commemorative (idempotent), and the caller injects `earnedAtTs`. No clock, no random.
 */

/** Rarity a tier earns on a win; `none` tier earns no commemorative. */
const RARITY_BY_TIER: Record<Tier, CommemorativeRarity | null> = {
  none: null,
  bronze: 'common',
  silver: 'rare',
  gold: 'epic',
  legendary: 'legendary',
};

/** One step down the rarity ladder (applied when the event failed). */
const RARITY_DOWNGRADE: Record<CommemorativeRarity, CommemorativeRarity> = {
  legendary: 'epic',
  epic: 'rare',
  rare: 'common',
  common: 'common',
};

export interface CommemorativeConfig {
  /** TTL (ms) applied per rarity. A `null` TTL means the badge never expires. */
  ttlMsByRarity: Record<CommemorativeRarity, number | null>;
}

/** Default FOMO windows: commoner badges lapse sooner; legendaries are forever. */
export const DEFAULT_COMMEMORATIVE_CONFIG: CommemorativeConfig = {
  ttlMsByRarity: {
    common: 7 * 24 * 60 * 60 * 1000, // 7 days
    rare: 30 * 24 * 60 * 60 * 1000, // 30 days
    epic: 90 * 24 * 60 * 60 * 1000, // 90 days
    legendary: null, // permanent keepsake
  },
};

export interface CommemorativeParams {
  eventId: string;
  playerId: string;
  tier: Tier;
  outcome: EventOutcome;
  earnedAtTs: number;
}

/** The rarity a participant earns for a tier + outcome, or null if the tier earns nothing. */
export function rarityFor(tier: Tier, outcome: EventOutcome): CommemorativeRarity | null {
  const base = RARITY_BY_TIER[tier];
  if (base === null) return null;
  return outcome === 'failed' ? RARITY_DOWNGRADE[base] : base;
}

/**
 * Build the commemorative a participant earns, or `null` if their tier earns none. Deterministic id
 * makes the grant idempotent across resolution re-runs (e.g. after auto-recovery).
 */
export function buildCommemorative(
  params: CommemorativeParams,
  config: CommemorativeConfig = DEFAULT_COMMEMORATIVE_CONFIG,
): Commemorative | null {
  const rarity = rarityFor(params.tier, params.outcome);
  if (rarity === null) return null;

  const ttl = config.ttlMsByRarity[rarity];
  return {
    commemorativeId: `${params.eventId}:${params.playerId}`,
    eventId: params.eventId,
    rarity,
    earnedAtTs: params.earnedAtTs,
    expiresAtTs: ttl === null ? null : params.earnedAtTs + ttl,
  };
}

/** Whether a commemorative has lapsed at `nowTs` (a `null` expiry never lapses). */
export function isExpired(commemorative: Commemorative, nowTs: number): boolean {
  return commemorative.expiresAtTs !== null && nowTs >= commemorative.expiresAtTs;
}
