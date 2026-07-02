import { describe, it, expect } from 'vitest';
import { computePacing, type PacingConfig } from './pacing.js';

const cfg = (over: Partial<PacingConfig> = {}): PacingConfig => ({
  targetWindowMs: 120_000,
  toleranceFraction: 0.1,
  ...over,
});

describe('phase pacing controller', () => {
  it('reports on-pace when completion tracks the ideal line', () => {
    // Halfway through the window, half done.
    const s = computePacing(60_000, 0.5, cfg());
    expect(s.status).toBe('on-pace');
    expect(s.expectedFraction).toBeCloseTo(0.5);
    expect(s.delta).toBeCloseTo(0);
  });

  it('reports ahead when the crowd out-paces the window', () => {
    const s = computePacing(30_000, 0.6, cfg()); // expected 0.25, actual 0.6
    expect(s.status).toBe('ahead');
    expect(s.delta).toBeGreaterThan(0);
  });

  it('reports behind when the crowd lags', () => {
    const s = computePacing(90_000, 0.2, cfg()); // expected 0.75, actual 0.2
    expect(s.status).toBe('behind');
    expect(s.delta).toBeLessThan(0);
  });

  it('honors the tolerance dead-band', () => {
    // expected 0.5, actual 0.55 -> within ±0.1 tolerance
    expect(computePacing(60_000, 0.55, cfg()).status).toBe('on-pace');
    // ...but 0.65 is outside it
    expect(computePacing(60_000, 0.65, cfg()).status).toBe('ahead');
  });

  it('reports expired once the window has fully elapsed', () => {
    expect(computePacing(120_000, 0.9, cfg()).status).toBe('expired');
    expect(computePacing(200_000, 1, cfg()).status).toBe('expired');
  });

  it('clamps out-of-range completion into [0,1]', () => {
    const s = computePacing(60_000, 1.5, cfg());
    expect(s.delta).toBeCloseTo(0.5); // actual clamped to 1, expected 0.5
  });

  it('rejects a non-positive window', () => {
    expect(() => computePacing(0, 0, cfg({ targetWindowMs: 0 }))).toThrow(/targetWindowMs/);
  });
});
