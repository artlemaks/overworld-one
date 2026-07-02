import { describe, it, expect } from 'vitest';
import { createAggregator } from './aggregation.js';

describe('contribution aggregation', () => {
  it('sums per-tick delta and wave count, then resets each sample', () => {
    const t = 0;
    const agg = createAggregator({ windowMs: 1000, now: () => t });
    agg.record({ playerId: 'a', delta: -50, ts: t });
    agg.record({ playerId: 'b', delta: -30, ts: t });

    const first = agg.sample();
    expect(first.stats.contribDelta).toBe(-80);
    expect(first.waveCount).toBe(2);

    // Nothing recorded since -> per-tick accumulators are back to zero.
    const second = agg.sample();
    expect(second.stats.contribDelta).toBe(0);
    expect(second.waveCount).toBe(0);
  });

  it('counts distinct players in the rolling window as presence', () => {
    const t = 0;
    const agg = createAggregator({ windowMs: 1000, now: () => t });
    agg.record({ playerId: 'a', delta: -1, ts: t });
    agg.record({ playerId: 'a', delta: -1, ts: t }); // same player twice
    agg.record({ playerId: 'b', delta: -1, ts: t });
    expect(agg.sample().playersContributingNow).toBe(2);
  });

  it('prunes presence once contributions age out of the window', () => {
    let t = 0;
    const agg = createAggregator({ windowMs: 1000, now: () => t });
    agg.record({ playerId: 'a', delta: -1, ts: t });
    agg.sample();
    t = 2000; // past the window
    expect(agg.sample().playersContributingNow).toBe(0);
  });

  it('reports contribution rate over the window', () => {
    const t = 0;
    const agg = createAggregator({ windowMs: 1000, now: () => t });
    for (let i = 0; i < 8; i++) agg.record({ playerId: `p${i}`, delta: -1, ts: t });
    // 8 contributions in a 1s window -> 8/s
    expect(agg.sample().stats.contribRate).toBe(8);
  });
});
