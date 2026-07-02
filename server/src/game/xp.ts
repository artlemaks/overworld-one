/**
 * Event XP engine (P2-S-3 / OOM-40).
 *
 * Turns an accepted contribution's authoritative points into event XP, scaled by the player's **combo
 * streak** and subject to a per-event cap + diminishing returns so a marathon session can't out-earn
 * everyone by sheer volume.
 *
 * **Non-pay-to-win (indication `enforce-non-p2w-guardrail`).** The combo multiplier is derived purely
 * from the *server-tracked* contribution cadence (`nextComboStreak`) — never a client-asserted combo,
 * which a cheat could pin high — and it is bounded by a constant `comboCap`. No purchase or pass tier
 * feeds this function, and the base `points` already carry the 1.0× skill cap from `scoring.ts`. XP is
 * a status/progression signal, not power, so it never touches the shared bar.
 *
 * Pure and deterministic (no clock, no random): the caller injects the timestamps and prior state, so
 * the whole thing is unit-testable in Node.
 */

export interface XpConfig {
  /** Base XP minted per authoritative point, before combo/diminishing. */
  xpPerPoint: number;
  /** Contributions within this gap (ms) extend the combo; a longer gap resets it. */
  comboWindowMs: number;
  /** Extra multiplier per streak step beyond the first. */
  comboStep: number;
  /** Hard ceiling on the combo multiplier (skill-only; purchases can never raise it). */
  comboCap: number;
  /** Once a player's event XP reaches this, further XP is earned at `diminishingRate`. */
  diminishingThresholdXp: number;
  /** Rate applied past the diminishing threshold (0..1). */
  diminishingRate: number;
  /** Absolute per-event XP cap — a player's `xpEarned` never exceeds this. */
  perEventXpCap: number;
}

/** Tuning for the P2 event loop. Kept here so tests and the server agree. */
export const DEFAULT_XP_CONFIG: XpConfig = {
  xpPerPoint: 0.5,
  comboWindowMs: 2500,
  comboStep: 0.1,
  comboCap: 2.0,
  diminishingThresholdXp: 500,
  diminishingRate: 0.5,
  perEventXpCap: 1000,
};

/**
 * The combo streak *after* a contribution at `ts`, given the player's previous streak and last
 * contribution time. A gap within `comboWindowMs` extends the streak; anything longer (or a first-ever
 * contribution, `prevLastTs === null`) resets it to 1.
 */
export function nextComboStreak(
  prevStreak: number,
  prevLastTs: number | null,
  ts: number,
  config: XpConfig,
): number {
  if (prevLastTs === null) return 1;
  return ts - prevLastTs <= config.comboWindowMs ? prevStreak + 1 : 1;
}

/** The combo multiplier for a streak length, bounded by `comboCap`. Streak 1 → 1.0×. */
export function comboMultiplier(streak: number, config: XpConfig): number {
  const raw = 1 + Math.max(0, streak - 1) * config.comboStep;
  return Math.min(config.comboCap, raw);
}

export interface XpInput {
  /** Authoritative points for this contribution (from `scoring.ts`). */
  points: number;
  /** The combo streak after this contribution (from {@link nextComboStreak}). */
  streak: number;
  /** XP the player has already earned this event (for diminishing + cap). */
  priorXp: number;
}

/**
 * XP awarded for one contribution: base scaled by combo, reduced past the diminishing threshold, then
 * clamped so cumulative XP never exceeds `perEventXpCap`. Always a non-negative integer.
 */
export function xpForContribution(input: XpInput, config: XpConfig = DEFAULT_XP_CONFIG): number {
  const combo = comboMultiplier(input.streak, config);
  const rate = input.priorXp >= config.diminishingThresholdXp ? config.diminishingRate : 1;
  const raw = Math.round(input.points * config.xpPerPoint * combo * rate);
  const remaining = Math.max(0, config.perEventXpCap - input.priorXp);
  return Math.max(0, Math.min(raw, remaining));
}
