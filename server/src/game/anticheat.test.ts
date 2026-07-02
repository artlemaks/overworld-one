import { describe, it, expect } from 'vitest';
import type { ContributionMessage } from '@overworld/shared';
import { validateContributionValues, createAnomalyDetector } from './anticheat.js';

const msg = (inputParams: Record<string, number>): ContributionMessage => ({
  playerId: 'p1',
  actionType: 'strike',
  inputParams,
  clientTs: 0,
});

describe('value validation', () => {
  it('accepts in-range finite signals', () => {
    expect(validateContributionValues(msg({ aimAccuracy: 0.5, timingQuality: 1 })).ok).toBe(true);
  });

  it('accepts absent signals (they default to 0 downstream)', () => {
    expect(validateContributionValues(msg({})).ok).toBe(true);
  });

  it('rejects out-of-range signals (value inflation)', () => {
    const r = validateContributionValues(msg({ aimAccuracy: 5 }));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/out_of_range/);
  });

  it('rejects negative signals', () => {
    expect(validateContributionValues(msg({ timingQuality: -0.1 })).ok).toBe(false);
  });

  it('rejects non-finite signals', () => {
    expect(validateContributionValues(msg({ aimAccuracy: Number.POSITIVE_INFINITY })).ok).toBe(false);
    expect(validateContributionValues(msg({ timingQuality: Number.NaN })).ok).toBe(false);
  });
});

describe('rate-anomaly detector', () => {
  it('accepts a human-plausible rate', () => {
    let t = 0;
    const d = createAnomalyDetector({ maxRatePerSec: 10, windowMs: 1000, now: () => t });
    for (let i = 0; i < 5; i++) {
      t += 200; // 5 in 1s = 5/s, under 10/s
      expect(d.record('p1').ok).toBe(true);
    }
  });

  it('flags a non-human rapid-fire rate', () => {
    let t = 0;
    const d = createAnomalyDetector({ maxRatePerSec: 10, windowMs: 1000, now: () => t });
    let flagged = false;
    for (let i = 0; i < 20; i++) {
      t += 10; // 100/s
      if (!d.record('p1').ok) flagged = true;
    }
    expect(flagged).toBe(true);
  });

  it('prunes old contributions out of the window so a burst does not flag forever', () => {
    let t = 0;
    const d = createAnomalyDetector({ maxRatePerSec: 10, windowMs: 1000, now: () => t });
    for (let i = 0; i < 15; i++) {
      t += 10;
      d.record('p1');
    }
    t += 5000; // long idle — window empties
    expect(d.record('p1').ok).toBe(true);
  });

  it('tracks players independently', () => {
    let t = 0;
    const d = createAnomalyDetector({ maxRatePerSec: 5, windowMs: 1000, now: () => t });
    for (let i = 0; i < 20; i++) {
      t += 10;
      d.record('bot');
    }
    // A fresh player at t is unaffected by the bot's history.
    expect(d.record('human').ok).toBe(true);
  });
});
