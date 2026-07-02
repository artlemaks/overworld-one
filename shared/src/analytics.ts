import { z } from 'zod';

/**
 * Soft-launch analytics KPI suite (P6-X-1 / OOM).
 *
 * The SINGLE SOURCE OF TRUTH for the launch success criteria (scope §11) as machine-checkable targets:
 * CCU, %contribute-in-30s (>80%), completion rate, time-to-complete vs window, virality/K-factor,
 * D1/D7 return, attendance streaks, payer conversion, ARPDAU, pass attach, ad opt-in. The metric
 * *definitions* live in `liveops.ts` (shared with the live-ops dashboard); this module adds the *targets*
 * and a pure {@link kpiStatus} that says, for a snapshot of live values, which KPIs are met. The tuning
 * loop (P6-X-3) reads this to decide what to adjust.
 *
 * Pure; no clock/I/O.
 */

/** A KPI target: the value we need `metricKey` to reach, and which direction counts as "met". */
export const KpiTarget = z.object({
  metricKey: z.string().min(1),
  target: z.number(),
  /** `gte` = higher is better (met when value >= target); `lte` = lower is better. */
  direction: z.enum(['gte', 'lte']),
});
export type KpiTarget = z.infer<typeof KpiTarget>;

/** The launch KPI targets (scope §11 success criteria). */
export const KPI_TARGETS: readonly KpiTarget[] = [
  { metricKey: 'contribute_in_30s_pct', target: 80, direction: 'gte' },
  { metricKey: 'completion_rate', target: 50, direction: 'gte' },
  { metricKey: 'tick_hz', target: 3, direction: 'gte' },
  { metricKey: 'd1_return', target: 30, direction: 'gte' },
  { metricKey: 'd7_return', target: 12, direction: 'gte' },
  { metricKey: 'k_factor', target: 1, direction: 'gte' },
  { metricKey: 'payer_conversion', target: 2, direction: 'gte' },
  { metricKey: 'bot_signal', target: 50, direction: 'lte' },
];

/** Per-KPI status for a snapshot of live values. */
export interface KpiStatus {
  metricKey: string;
  value: number | null;
  target: number;
  met: boolean;
}

/** Whether one KPI is met given a value. */
export function kpiMet(target: KpiTarget, value: number): boolean {
  return target.direction === 'gte' ? value >= target.target : value <= target.target;
}

/**
 * Evaluate every KPI target against a snapshot. A metric absent from the snapshot is reported with
 * `value: null` and `met: false` (we can't claim a target we aren't measuring).
 */
export function kpiStatus(
  values: Record<string, number>,
  targets: readonly KpiTarget[] = KPI_TARGETS,
): KpiStatus[] {
  return targets.map((t) => {
    const value = values[t.metricKey];
    return {
      metricKey: t.metricKey,
      value: value ?? null,
      target: t.target,
      met: value !== undefined && kpiMet(t, value),
    };
  });
}

/** Convenience: the fraction (0..1) of KPIs currently met — the top-line launch-health number. */
export function launchHealth(values: Record<string, number>, targets = KPI_TARGETS): number {
  const statuses = kpiStatus(values, targets);
  if (statuses.length === 0) return 0;
  return statuses.filter((s) => s.met).length / statuses.length;
}
