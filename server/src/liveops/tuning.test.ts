import { describe, it, expect } from 'vitest';
import { proposeTuning, type TuningState } from './tuning.js';

const base: TuningState = { pacingMultiplier: 1, difficultyMultiplier: 1, cadenceMs: 600_000 };

describe('post-launch tuning loop', () => {
  it('eases difficulty + pacing and shortens cadence when contribute-in-30s is below target', () => {
    const { next, reasons } = proposeTuning(base, { contribute_in_30s_pct: 60 });
    expect(next.difficultyMultiplier).toBeCloseTo(0.9);
    expect(next.pacingMultiplier).toBeCloseTo(1.1);
    expect(next.cadenceMs).toBeLessThan(base.cadenceMs);
    expect(reasons.join(' ')).toMatch(/eased/);
  });

  it('tightens difficulty when completion is saturated', () => {
    const { next } = proposeTuning(base, { contribute_in_30s_pct: 90, completion_rate: 99 });
    expect(next.difficultyMultiplier).toBeCloseTo(1.1);
  });

  it('makes no change when KPIs are within targets', () => {
    const { next, reasons } = proposeTuning(base, { contribute_in_30s_pct: 85, completion_rate: 60 });
    expect(next).toEqual(base);
    expect(reasons).toContain('KPIs within targets: no change');
  });

  it('clamps multipliers to the safe range', () => {
    const low: TuningState = { ...base, difficultyMultiplier: 0.5 };
    const { next } = proposeTuning(low, { contribute_in_30s_pct: 10 });
    expect(next.difficultyMultiplier).toBeGreaterThanOrEqual(0.5);
    // cadence never drops below the 60s floor
    const tight: TuningState = { ...base, cadenceMs: 61_000 };
    const { next: n2 } = proposeTuning(tight, { contribute_in_30s_pct: 10 });
    expect(n2.cadenceMs).toBeGreaterThanOrEqual(60_000);
  });
});
