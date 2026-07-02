import { z } from 'zod';

/**
 * Live-ops dashboards & alert-rule contracts (P5-X-4 observability / P6-X-1 analytics suite).
 *
 * The SINGLE SOURCE OF TRUTH for the *definitions* of the metrics the live-ops console charts and the
 * alert rules that page an operator. This is config, not collection: it declares WHICH metrics matter
 * (concurrency, event health, contribution distribution, payer cohorts, abuse signals) and the
 * thresholds that trip an alert (tick degradation, bot patterns, event timeouts). The P5 admin console
 * (P3-X-3a) renders {@link DASHBOARD_METRICS}; the server metrics registry evaluates {@link AlertRule}s
 * against live values. Keeping the catalog here means the dashboard and the alerting agree on the metric
 * set (indication `contracts-single-source-of-truth`).
 *
 * Pure data + a pure rule evaluator; no clock/I/O.
 */

/** A metric surfaced on the live-ops dashboard. `unit` drives axis formatting only. */
export const DashboardMetric = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.enum(['count', 'per-second', 'ms', 'percent', 'currency']),
  /** Grouping for the dashboard layout. */
  group: z.enum(['concurrency', 'event-health', 'contribution', 'monetization', 'abuse']),
});
export type DashboardMetric = z.infer<typeof DashboardMetric>;

/** The launch/live-ops metric catalog (scope §11 success criteria + P6 analytics). */
export const DASHBOARD_METRICS: readonly DashboardMetric[] = [
  { key: 'ccu', label: 'Concurrent players', unit: 'count', group: 'concurrency' },
  { key: 'ccu_peak', label: 'Peak CCU', unit: 'count', group: 'concurrency' },
  { key: 'tick_hz', label: 'Tick rate', unit: 'per-second', group: 'event-health' },
  { key: 'contribute_in_30s_pct', label: '% contributing in 30s', unit: 'percent', group: 'event-health' },
  { key: 'completion_rate', label: 'Event completion rate', unit: 'percent', group: 'event-health' },
  { key: 'time_to_complete_ms', label: 'Time to complete', unit: 'ms', group: 'event-health' },
  { key: 'contrib_distribution', label: 'Contribution distribution', unit: 'count', group: 'contribution' },
  { key: 'per_client_bandwidth', label: 'Per-client bandwidth', unit: 'count', group: 'event-health' },
  { key: 'payer_conversion', label: 'Payer conversion', unit: 'percent', group: 'monetization' },
  { key: 'arpdau', label: 'ARPDAU', unit: 'currency', group: 'monetization' },
  { key: 'pass_attach', label: 'Pass attach rate', unit: 'percent', group: 'monetization' },
  { key: 'ad_opt_in', label: 'Ad opt-in rate', unit: 'percent', group: 'monetization' },
  { key: 'd1_return', label: 'D1 return', unit: 'percent', group: 'concurrency' },
  { key: 'd7_return', label: 'D7 return', unit: 'percent', group: 'concurrency' },
  { key: 'k_factor', label: 'Virality / K-factor', unit: 'count', group: 'concurrency' },
  { key: 'bot_signal', label: 'Abuse / bot signal', unit: 'per-second', group: 'abuse' },
];

/** Comparison an alert rule applies. */
export const AlertComparator = z.enum(['lt', 'gt']);
export type AlertComparator = z.infer<typeof AlertComparator>;

/** An alert rule: page when `metricKey` crosses `threshold` in the `comparator` direction. */
export const AlertRule = z.object({
  ruleId: z.string().min(1),
  metricKey: z.string().min(1),
  comparator: AlertComparator,
  threshold: z.number(),
  severity: z.enum(['info', 'warn', 'page']),
  description: z.string().min(1),
});
export type AlertRule = z.infer<typeof AlertRule>;

/** The launch alert rules (scope §11: tick degradation, bot patterns, event timeouts, the 80%-in-30s gate). */
export const ALERT_RULES: readonly AlertRule[] = [
  { ruleId: 'tick-degraded', metricKey: 'tick_hz', comparator: 'lt', threshold: 3, severity: 'page', description: 'Tick rate fell below the 3Hz floor' },
  { ruleId: 'contribute-gate', metricKey: 'contribute_in_30s_pct', comparator: 'lt', threshold: 80, severity: 'warn', description: 'Under 80% of players contributing within 30s' },
  { ruleId: 'bot-surge', metricKey: 'bot_signal', comparator: 'gt', threshold: 50, severity: 'page', description: 'Abuse/bot signal spiking' },
  { ruleId: 'event-timeout', metricKey: 'completion_rate', comparator: 'lt', threshold: 20, severity: 'warn', description: 'Events timing out without completion' },
];

/** Whether a metric value trips a rule. Pure. */
export function ruleTrips(rule: AlertRule, value: number): boolean {
  return rule.comparator === 'lt' ? value < rule.threshold : value > rule.threshold;
}

/** Evaluate all rules against a snapshot of metric values; returns the rules that are firing. */
export function firingAlerts(
  rules: readonly AlertRule[],
  values: Record<string, number>,
): AlertRule[] {
  return rules.filter((r) => {
    const v = values[r.metricKey];
    return v !== undefined && ruleTrips(r, v);
  });
}
