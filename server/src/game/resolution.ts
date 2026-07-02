import type { Tier, EventOutcome, PlayerResolution } from '@overworld/shared';
import type { ParticipantStore } from '../state/participants.js';
import type {
  PersistenceStore,
  ParticipantResultRow,
  CounterDirection,
} from '../state/persistence.js';
import {
  buildCommemorative,
  DEFAULT_COMMEMORATIVE_CONFIG,
  type CommemorativeConfig,
} from './commemoratives.js';

/**
 * Resolution flow (P2-S-4 / OOM-43).
 *
 * Runs once when an event reaches a terminal outcome: it tallies the per-player ledger into tiers,
 * grants rewards (event XP already accrued during play + a tier-appropriate commemorative), writes the
 * durable final rows, marks the event resolved/failed, and returns the per-player
 * {@link PlayerResolution} payloads the WS layer sends to each client for the resolution screen.
 *
 * **Idempotent** — commemorative ids and participant rows are keyed on `(eventId, playerId)` and every
 * write is an upsert, so a resolution that re-runs after auto-recovery (P2-X-1) produces the same
 * durable state and the same payloads, never double-granting.
 */

/** Ascending absolute-contribution thresholds that map a player's total to a reward tier. */
export interface TierConfig {
  bronze: number;
  silver: number;
  gold: number;
  legendary: number;
}

/** Default tiers — participation earns bronze; the thresholds climb from there. */
export const DEFAULT_TIER_CONFIG: TierConfig = {
  bronze: 100,
  silver: 1000,
  gold: 5000,
  legendary: 20_000,
};

/** The highest tier whose threshold the contribution total clears; below bronze → `none`. */
export function computeTier(contributionTotal: number, config: TierConfig = DEFAULT_TIER_CONFIG): Tier {
  if (contributionTotal >= config.legendary) return 'legendary';
  if (contributionTotal >= config.gold) return 'gold';
  if (contributionTotal >= config.silver) return 'silver';
  if (contributionTotal >= config.bronze) return 'bronze';
  return 'none';
}

export interface ResolutionDeps {
  participants: ParticipantStore;
  persistence: PersistenceStore;
  /** Injectable clock (epoch ms). */
  now: () => number;
}

export interface ResolutionParams {
  eventId: string;
  outcome: EventOutcome;
  /** Event header fields, persisted with the terminal status. */
  hpMax: number;
  direction: CounterDirection;
  startedAtTs: number;
  /** ms until the next event opens, echoed to clients for the resolution-screen countdown. */
  nextEventInMs: number;
  tierConfig?: TierConfig;
  commemorativeConfig?: CommemorativeConfig;
}

/**
 * Resolve an event: tally, grant, persist, and return per-player payloads. Players who never
 * contributed are absent from the ledger and therefore from the result (nothing to resolve).
 */
export async function resolveEvent(
  deps: ResolutionDeps,
  params: ResolutionParams,
): Promise<PlayerResolution[]> {
  const tierConfig = params.tierConfig ?? DEFAULT_TIER_CONFIG;
  const commemorativeConfig = params.commemorativeConfig ?? DEFAULT_COMMEMORATIVE_CONFIG;
  const resolvedAtTs = deps.now();

  const ledger = await deps.participants.list(params.eventId);
  const rows: ParticipantResultRow[] = [];
  const resolutions: PlayerResolution[] = [];

  for (const p of ledger) {
    const tier = computeTier(p.contributionTotal, tierConfig);
    const commemorative = buildCommemorative(
      { eventId: params.eventId, playerId: p.playerId, tier, outcome: params.outcome, earnedAtTs: resolvedAtTs },
      commemorativeConfig,
    );

    rows.push({
      eventId: params.eventId,
      playerId: p.playerId,
      contributionTotal: p.contributionTotal,
      tier,
      xpEarned: p.xpEarned,
      participationDurationMs: Math.max(0, p.lastTs - p.firstTs),
      lastUpdateTs: p.lastTs,
    });

    if (commemorative) await deps.persistence.grantCommemorative(p.playerId, commemorative);

    resolutions.push({
      eventId: params.eventId,
      playerId: p.playerId,
      outcome: params.outcome,
      tier,
      contributionTotal: p.contributionTotal,
      xpEarned: p.xpEarned,
      commemorative,
      nextEventInMs: params.nextEventInMs,
    });
  }

  await deps.persistence.saveParticipants(rows);
  await deps.persistence.upsertEvent({
    eventId: params.eventId,
    status: params.outcome === 'completed' ? 'resolved' : 'failed',
    outcome: params.outcome,
    hpMax: params.hpMax,
    direction: params.direction,
    startedAtTs: params.startedAtTs,
    resolvedAtTs,
  });

  return resolutions;
}
