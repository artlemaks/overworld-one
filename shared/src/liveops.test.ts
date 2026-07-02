import { describe, it, expect } from 'vitest';
import { DASHBOARD_METRICS, ALERT_RULES, ruleTrips, firingAlerts } from './liveops.js';

describe('live-ops dashboards + alerts', () => {
  it('ships the launch-gate metrics', () => {
    const keys = DASHBOARD_METRICS.map((m) => m.key);
    expect(keys).toContain('ccu');
    expect(keys).toContain('tick_hz');
    expect(keys).toContain('contribute_in_30s_pct');
  });

  it('ruleTrips honors comparator direction', () => {
    const lt = ALERT_RULES.find((r) => r.ruleId === 'tick-degraded')!;
    expect(ruleTrips(lt, 2.5)).toBe(true); // 2.5 < 3
    expect(ruleTrips(lt, 5)).toBe(false);
    const gt = ALERT_RULES.find((r) => r.ruleId === 'bot-surge')!;
    expect(ruleTrips(gt, 100)).toBe(true); // 100 > 50
    expect(ruleTrips(gt, 10)).toBe(false);
  });

  it('firingAlerts returns only tripped rules present in the snapshot', () => {
    const firing = firingAlerts(ALERT_RULES, { tick_hz: 2, contribute_in_30s_pct: 90, bot_signal: 5 });
    expect(firing.map((r) => r.ruleId)).toEqual(['tick-degraded']);
  });

  it('ignores metrics missing from the snapshot', () => {
    expect(firingAlerts(ALERT_RULES, {})).toEqual([]);
  });
});
