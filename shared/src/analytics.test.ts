import { describe, it, expect } from 'vitest';
import { KPI_TARGETS, kpiMet, kpiStatus, launchHealth } from './analytics.js';

describe('launch KPI suite', () => {
  it('includes the headline 80%-in-30s gate as gte', () => {
    const t = KPI_TARGETS.find((k) => k.metricKey === 'contribute_in_30s_pct')!;
    expect(t.target).toBe(80);
    expect(t.direction).toBe('gte');
  });

  it('kpiMet honors direction (gte vs lte)', () => {
    expect(kpiMet({ metricKey: 'x', target: 80, direction: 'gte' }, 85)).toBe(true);
    expect(kpiMet({ metricKey: 'x', target: 80, direction: 'gte' }, 79)).toBe(false);
    expect(kpiMet({ metricKey: 'y', target: 50, direction: 'lte' }, 30)).toBe(true);
    expect(kpiMet({ metricKey: 'y', target: 50, direction: 'lte' }, 60)).toBe(false);
  });

  it('reports absent metrics as null + not met', () => {
    const s = kpiStatus({});
    expect(s.every((k) => k.value === null && k.met === false)).toBe(true);
  });

  it('launchHealth is the fraction of KPIs met', () => {
    // Meet exactly the two easy ones.
    const values = { tick_hz: 5, bot_signal: 0 };
    const health = launchHealth(values);
    expect(health).toBeGreaterThan(0);
    expect(health).toBeLessThan(1);
    expect(launchHealth({})).toBe(0);
  });
});
