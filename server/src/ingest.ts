import type { ContributionMessage } from '@overworld/shared';
import type { EventEngine } from './game/event.js';
import type { PubSub } from './state/pubsub.js';
import type { RateLimiter } from './game/ratelimit.js';
import type { AnomalyDetector } from './game/anticheat.js';
import { validateContributionValues } from './game/anticheat.js';
import { computeContributionPoints } from './game/scoring.js';
import { nextComboStreak, xpForContribution, DEFAULT_XP_CONFIG, type XpConfig } from './game/xp.js';
import type { ParticipantStore } from './state/participants.js';
import type { Metrics } from './metrics/registry.js';

/**
 * Contribution ingest pipeline (P1-S-3 / OOM-27).
 *
 * The one gate every contribution passes through, in a fixed order so a rejection is cheap and never
 * mutates authoritative state:
 *
 *   1. **value validation** — reject inflated/non-finite signals (anti-cheat, pure);
 *   2. **rate limit** — token bucket per IP key (P1-S-4);
 *   3. **rate-anomaly** — flag non-human contribution rates (P1-X-2);
 *   4. **score** — the server computes the point value; the client asserts nothing (the load-bearing
 *      invariant of this task);
 *   5. **apply** — atomic, clamped counter delta (P1-S-2);
 *   6. **track** — fold the contribution into the per-player ledger with a server-derived combo +
 *      event XP (P2-D-1 / P2-S-3);
 *   7. **publish** — fan the accepted contribution out to every node's aggregator (P1-S-6).
 *
 * Only steps 5–7 touch shared state, and only after every check has passed, so a rejected or cheating
 * contribution can never move the bar. Returns a plain result the WS layer turns into a `contribAck`.
 */

export interface IngestDeps {
  eventId: string;
  engine: EventEngine;
  pubsub: PubSub;
  limiter: RateLimiter;
  detector: AnomalyDetector;
  metrics: Metrics;
  /** Per-player contribution ledger (P2-D-1). */
  participants: ParticipantStore;
  /** XP tuning (P2-S-3); defaults to {@link DEFAULT_XP_CONFIG}. */
  xpConfig?: XpConfig;
  /** Injectable clock (epoch ms). */
  now: () => number;
}

export interface IngestResult {
  accepted: boolean;
  /** Authoritative points applied (0 when rejected). */
  points: number;
  /** Event XP earned by this contribution (0 when rejected). */
  xp: number;
  /** Server-derived combo streak after this contribution (0 when rejected). */
  streak: number;
  /** Rejection reason (omitted when accepted). */
  reason?: string;
}

function reject(metrics: Metrics, reason: string): IngestResult {
  metrics.recordContribution(false);
  return { accepted: false, points: 0, xp: 0, streak: 0, reason };
}

export async function ingestContribution(
  deps: IngestDeps,
  msg: ContributionMessage,
  rateKey: string,
): Promise<IngestResult> {
  const valueCheck = validateContributionValues(msg);
  if (!valueCheck.ok) return reject(deps.metrics, valueCheck.reason ?? 'invalid_value');

  const limit = deps.limiter.check(rateKey);
  if (!limit.allowed) return reject(deps.metrics, 'rate_limited');

  const anomaly = deps.detector.record(msg.playerId);
  if (!anomaly.ok) return reject(deps.metrics, anomaly.reason ?? 'rate_anomaly');

  // Server owns the number — the client's inputParams are signals, never an asserted score.
  const points = computeContributionPoints(msg);
  const applied = await deps.engine.applyContribution(points);

  // Per-player ledger: derive the combo streak from this player's own server-tracked cadence (never
  // a client-asserted combo) and mint capped event XP off it (P2-D-1 / P2-S-3).
  const xpConfig = deps.xpConfig ?? DEFAULT_XP_CONFIG;
  const ts = deps.now();
  const prior = await deps.participants.get(deps.eventId, msg.playerId);
  const streak = nextComboStreak(prior?.comboStreak ?? 0, prior?.lastTs ?? null, ts, xpConfig);
  const xp = xpForContribution({ points, streak, priorXp: prior?.xpEarned ?? 0 }, xpConfig);
  await deps.participants.record(deps.eventId, msg.playerId, { points, xp, streak, ts });

  await deps.pubsub.publish({
    eventId: deps.eventId,
    playerId: msg.playerId,
    points,
    delta: applied.delta,
    ts,
  });

  deps.metrics.recordContribution(true);
  return { accepted: true, points, xp, streak };
}
