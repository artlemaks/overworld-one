import {
  ALERT_RULES,
  DASHBOARD_METRICS,
  firingAlerts,
  type AlertRule,
  type DashboardMetric,
} from '@overworld/shared';

/**
 * Live-ops alert evaluator (P5-X-4 observability / OOM).
 *
 * The server-side companion to the shared live-ops contract (`@overworld/shared` `liveops.ts`), which is
 * the single source of truth for both the dashboard metric catalog and the alert rules. This module is a
 * thin, pure adapter the metrics registry (`registry.ts`) drives once per sampling window: it takes a
 * snapshot of live metric values, asks the shared {@link firingAlerts} which rules trip, and hands the
 * admin console the {@link DASHBOARD_METRICS} catalog to render.
 *
 * Pure: no clock, no randomness, no I/O — the caller supplies the values snapshot. Fully unit-testable in
 * Node. The default rule set is the shared {@link ALERT_RULES} so the console and the alerting agree.
 */

export interface AlertEvaluatorDeps {
  /** The rules to evaluate against each snapshot. Defaults to the shared {@link ALERT_RULES}. */
  rules?: readonly AlertRule[];
}

export interface AlertEvaluator {
  /**
   * Evaluate the configured rules against a snapshot of metric values (keyed by
   * {@link DashboardMetric.key}). Returns the firing rules; metric keys absent from the snapshot, and
   * snapshot keys with no rule, are ignored.
   */
  evaluate(values: Record<string, number>): AlertRule[];
  /** The dashboard metric catalog the admin console renders. */
  metricsCatalog(): readonly DashboardMetric[];
}

export function createAlertEvaluator(deps: AlertEvaluatorDeps = {}): AlertEvaluator {
  const rules = deps.rules ?? ALERT_RULES;

  return {
    evaluate(values: Record<string, number>): AlertRule[] {
      return firingAlerts(rules, values);
    },
    metricsCatalog(): readonly DashboardMetric[] {
      return DASHBOARD_METRICS;
    },
  };
}
