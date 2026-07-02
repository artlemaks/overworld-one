import type { ContributionMessage } from '@overworld/shared';

/**
 * Early anti-cheat (P1-X-2 / OOM-34).
 *
 * **Threat model for P1 = simple rapid-fire + value inflation.** Heavier defence-in-depth
 * (PoW/hCaptcha challenge on first contribution) is P5 and explicitly *not* required for the P1 gate.
 * Two independent checks, both cheap enough to run inline on every contribution:
 *
 *  1. **Value validation** ({@link validateContributionValues}) — pure. Rejects a contribution whose
 *     skill signals are outside the plausible [0,1] range or non-finite. This is the "a client can't
 *     assert an inflated number" backstop that pairs with server-authoritative scoring: even the
 *     *inputs* to the formula are bounded.
 *  2. **Rate-anomaly detection** ({@link createAnomalyDetector}) — stateful per player. Flags a player
 *     sustaining a contribution rate no human hand could (distinct from the token-bucket rate limiter,
 *     which merely throttles; this *labels* the player so the server can drop and, later, escalate).
 *
 * Rejections are returned as data, never thrown — the ingest pipeline turns them into a `contribAck`
 * with `accepted: false`.
 */

export interface CheckResult {
  ok: boolean;
  /** Machine-readable reason when `ok` is false (surfaced in the contribAck). */
  reason?: string;
}

/** Plausible bounds for the primitive skill signals the scorer trusts. */
const SIGNAL_KEYS = ['aimAccuracy', 'timingQuality'] as const;

/**
 * Validate that a contribution's skill signals are in-range and finite. Anything a cheating client
 * inflates (NaN, Infinity, negatives, > 1) is rejected here before it can reach the scorer.
 */
export function validateContributionValues(msg: ContributionMessage): CheckResult {
  for (const key of SIGNAL_KEYS) {
    const v = msg.inputParams[key];
    if (v === undefined) continue; // absent signal defaults to 0 in the scorer — harmless
    if (!Number.isFinite(v)) return { ok: false, reason: `non_finite:${key}` };
    if (v < 0 || v > 1) return { ok: false, reason: `out_of_range:${key}` };
  }
  return { ok: true };
}

export interface AnomalyDetectorOptions {
  /** Sustained contributions/sec above which a player is flagged as non-human. */
  maxRatePerSec: number;
  /** Rolling window the rate is measured over. */
  windowMs: number;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
}

export interface AnomalyDetector {
  /**
   * Record a contribution from `playerId` at the current time and report whether the player's rate
   * over the window is within human bounds. Returns `{ ok: false }` once the window rate exceeds the
   * threshold.
   */
  record(playerId: string): CheckResult;
  /** Forget a player's history (e.g. on disconnect). */
  forget(playerId: string): void;
}

/**
 * Sliding-window rate-anomaly detector. Keeps recent contribution timestamps per player, prunes the
 * window on each record, and flags when the count implies a rate no human could sustain.
 */
export function createAnomalyDetector(opts: AnomalyDetectorOptions): AnomalyDetector {
  const { maxRatePerSec, windowMs } = opts;
  const now = opts.now ?? (() => Date.now());
  if (maxRatePerSec <= 0) throw new Error('maxRatePerSec must be > 0');
  if (windowMs <= 0) throw new Error('windowMs must be > 0');

  const maxInWindow = maxRatePerSec * (windowMs / 1000);
  const history = new Map<string, number[]>();

  return {
    record(playerId) {
      const ts = now();
      const cutoff = ts - windowMs;
      const times = (history.get(playerId) ?? []).filter((t) => t > cutoff);
      times.push(ts);
      history.set(playerId, times);

      if (times.length > maxInWindow) {
        return { ok: false, reason: 'rate_anomaly' };
      }
      return { ok: true };
    },
    forget(playerId) {
      history.delete(playerId);
    },
  };
}
