/**
 * Phase pacing with a target completion window (P2-S-2 / OOM-38).
 *
 * An event is authored to *feel* like it lasts a target duration regardless of how many players show
 * up. This module is the pure controller behind that: given how far into the window we are and how
 * complete the objective is, it says whether the crowd is **ahead**, **on pace**, or **behind** an
 * ideal linear burn-down — and by how much.
 *
 * The server uses that signal to drive transitions (P2-S-2 is "server-driven transitions"): when the
 * window has fully elapsed the pacing controller reports `expired`, which the lifecycle turns into a
 * `resolving`/`failed` transition; a persistent `ahead`/`behind` reading is what a P3 campaign or the
 * live-ops console will later nudge difficulty from. Kept pure (no clock, no I/O) so it is trivially
 * unit-testable and deterministic — the caller injects elapsed time and completion.
 */

export type PacingStatus = 'ahead' | 'on-pace' | 'behind' | 'expired';

export interface PacingConfig {
  /** Authored target duration of the active window, in ms. */
  targetWindowMs: number;
  /**
   * Dead-band around the ideal line, as a fraction (0..1) of completion. Within ±this the crowd is
   * "on pace"; outside it they are ahead/behind. Keeps the signal from flapping.
   */
  toleranceFraction?: number;
}

export interface PacingSignal {
  status: PacingStatus;
  /** Where an on-pace crowd *should* be (0..1) at this elapsed time. */
  expectedFraction: number;
  /** actualFraction − expectedFraction; positive = ahead of schedule. */
  delta: number;
}

const DEFAULT_TOLERANCE = 0.1;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Compute the pacing signal.
 *
 * @param elapsedMs        ms since the active window opened.
 * @param completionFraction  objective completeness in [0,1] (0 = untouched, 1 = done).
 */
export function computePacing(
  elapsedMs: number,
  completionFraction: number,
  config: PacingConfig,
): PacingSignal {
  if (config.targetWindowMs <= 0) throw new Error('targetWindowMs must be > 0');
  const tolerance = config.toleranceFraction ?? DEFAULT_TOLERANCE;

  const actual = clamp01(completionFraction);
  const expectedFraction = clamp01(elapsedMs / config.targetWindowMs);
  const delta = actual - expectedFraction;

  // Window fully elapsed: the event resolves regardless of how far the crowd got (completion is
  // handled separately by the engine; here `expired` just means "time's up").
  if (elapsedMs >= config.targetWindowMs) {
    return { status: 'expired', expectedFraction, delta };
  }

  let status: PacingStatus = 'on-pace';
  if (delta > tolerance) status = 'ahead';
  else if (delta < -tolerance) status = 'behind';

  return { status, expectedFraction, delta };
}
