import { describe, it, expect } from 'vitest';
import { tickRateForLoad, autoscaleDecision, DEGRADE_SPAN_MULTIPLIER } from './degradation.js';

describe('tickRateForLoad', () => {
  const base = { baseHz: 20, minHz: 3, softCapCcu: 1000 };

  it('runs at baseHz at and under the soft cap', () => {
    expect(tickRateForLoad({ ...base, ccu: 0 })).toBe(20);
    expect(tickRateForLoad({ ...base, ccu: 500 })).toBe(20);
    expect(tickRateForLoad({ ...base, ccu: 1000 })).toBe(20);
  });

  it('degrades linearly above the soft cap', () => {
    // span = 1 * 1000 = 1000; at +500 (halfway) we are halfway between 20 and 3.
    const mid = tickRateForLoad({ ...base, ccu: 1500 });
    expect(mid).toBeCloseTo(20 - 0.5 * (20 - 3), 5);
    expect(mid).toBeLessThan(20);
    expect(mid).toBeGreaterThan(3);
  });

  it('floors at minHz once fully degraded and never dips below it', () => {
    const span = DEGRADE_SPAN_MULTIPLIER * base.softCapCcu;
    expect(tickRateForLoad({ ...base, ccu: base.softCapCcu + span })).toBe(3);
    // Way past the span stays clamped at the floor.
    expect(tickRateForLoad({ ...base, ccu: 100_000 })).toBe(3);
  });
});

describe('autoscaleDecision', () => {
  const base = { perNodeCapacity: 1000, currentNodes: 1, maxNodes: 10 };

  it('scales up with ccu (ceil of the ratio)', () => {
    expect(autoscaleDecision({ ...base, ccu: 2500 }).desiredNodes).toBe(3);
    expect(autoscaleDecision({ ...base, ccu: 3000 }).desiredNodes).toBe(3);
    expect(autoscaleDecision({ ...base, ccu: 3001 }).desiredNodes).toBe(4);
  });

  it('never drops below 1 node, even at zero ccu', () => {
    expect(autoscaleDecision({ ...base, ccu: 0 }).desiredNodes).toBe(1);
  });

  it('clamps to maxNodes under extreme load', () => {
    expect(autoscaleDecision({ ...base, ccu: 1_000_000 }).desiredNodes).toBe(10);
  });
});
