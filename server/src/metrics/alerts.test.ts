import { describe, it, expect } from 'vitest';
import { DASHBOARD_METRICS } from '@overworld/shared';
import { createAlertEvaluator } from './alerts.js';

describe('alert evaluator', () => {
  it('fires the tick-degraded rule when tick rate is under the 3Hz floor', () => {
    const ev = createAlertEvaluator();
    const firing = ev.evaluate({ tick_hz: 2.5 });
    expect(firing.map((r) => r.ruleId)).toContain('tick-degraded');
  });

  it('does not fire tick-degraded at or above the floor', () => {
    const ev = createAlertEvaluator();
    expect(ev.evaluate({ tick_hz: 3 }).map((r) => r.ruleId)).not.toContain('tick-degraded');
    expect(ev.evaluate({ tick_hz: 20 }).map((r) => r.ruleId)).not.toContain('tick-degraded');
  });

  it('yields no alerts for a healthy snapshot', () => {
    const ev = createAlertEvaluator();
    const firing = ev.evaluate({
      tick_hz: 20,
      contribute_in_30s_pct: 95,
      bot_signal: 1,
      completion_rate: 90,
    });
    expect(firing).toHaveLength(0);
  });

  it('ignores unknown metric keys in the snapshot', () => {
    const ev = createAlertEvaluator();
    const firing = ev.evaluate({ not_a_real_metric: -999, another_unknown: 0 });
    expect(firing).toHaveLength(0);
  });

  it('ignores rules whose metric is absent from the snapshot', () => {
    const ev = createAlertEvaluator();
    // Only bot_signal present and spiking — the tick/gate/timeout rules must not fire on missing keys.
    const firing = ev.evaluate({ bot_signal: 100 });
    expect(firing.map((r) => r.ruleId)).toEqual(['bot-surge']);
  });

  it('exposes the shared dashboard metric catalog', () => {
    const ev = createAlertEvaluator();
    expect(ev.metricsCatalog()).toBe(DASHBOARD_METRICS);
  });

  it('honours a custom rule set when provided', () => {
    const ev = createAlertEvaluator({
      rules: [
        { ruleId: 'custom', metricKey: 'ccu', comparator: 'gt', threshold: 100, severity: 'info', description: 'test' },
      ],
    });
    expect(ev.evaluate({ ccu: 150 }).map((r) => r.ruleId)).toEqual(['custom']);
    expect(ev.evaluate({ ccu: 50 })).toHaveLength(0);
  });
});
