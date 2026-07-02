import { kpiStatus, type KpiTarget } from '@overworld/shared';

/**
 * Post-launch tuning loop (P6-X-3 / OOM).
 *
 * The pure decision core of the post-launch tuning loop (scope §10/§11): read the live KPI snapshot and
 * propose bounded adjustments to pacing, difficulty, and event cadence. It never mutates a live event
 * directly — it emits a {@link TuningAdjustment} that an operator applies via the audited event-control
 * API (P3-X-3b), keeping a human in the loop and every change on the audit trail. Deterministic and
 * clamped, so the loop can run unattended without drifting.
 *
 * The heuristics are intentionally simple and safe: if too few players are contributing in time, ease
 * pacing/difficulty and shorten cadence (more, gentler events); if the objective is completing far too
 * fast, tighten. Bounded to ±1 step per pass.
 */

export interface TuningState {
  /** 0.5..2 — scales the target-completion window (higher = more forgiving). */
  pacingMultiplier: number;
  /** 0.5..2 — scales counter magnitude (higher = harder). */
  difficultyMultiplier: number;
  /** ms between scheduled marquee events. */
  cadenceMs: number;
}

export interface TuningAdjustment {
  next: TuningState;
  /** Human-readable reasons, for the audit-logged control command an operator issues. */
  reasons: string[];
}

const STEP = 0.1;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Propose the next tuning state from a KPI snapshot. Pure. `values` is the same metric map the analytics
 * suite reads; `targets` defaults to the shared launch KPI targets.
 */
export function proposeTuning(
  state: TuningState,
  values: Record<string, number>,
  targets?: readonly KpiTarget[],
): TuningAdjustment {
  const statuses = kpiStatus(values, targets);
  const byKey = new Map(statuses.map((s) => [s.metricKey, s]));
  const reasons: string[] = [];
  const next: TuningState = { ...state };

  const contribute = byKey.get('contribute_in_30s_pct');
  if (contribute && contribute.value !== null && !contribute.met) {
    // Too few contributing in time → ease off and run events more often.
    next.difficultyMultiplier = clamp(next.difficultyMultiplier - STEP, 0.5, 2);
    next.pacingMultiplier = clamp(next.pacingMultiplier + STEP, 0.5, 2);
    next.cadenceMs = Math.max(60_000, Math.round(next.cadenceMs * 0.9));
    reasons.push('contribute-in-30s below target: eased difficulty + pacing, shortened cadence');
  }

  const completion = byKey.get('completion_rate');
  if (completion && completion.value !== null && completion.value > 95) {
    // Completing almost every time, very fast → tighten difficulty a notch.
    next.difficultyMultiplier = clamp(next.difficultyMultiplier + STEP, 0.5, 2);
    reasons.push('completion rate saturated: tightened difficulty');
  }

  if (reasons.length === 0) reasons.push('KPIs within targets: no change');
  return { next, reasons };
}
