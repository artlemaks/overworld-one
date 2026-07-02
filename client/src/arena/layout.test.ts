import { describe, it, expect } from 'vitest';
import { computeArenaLayout, prefersReducedMotion } from './layout.js';

describe('computeArenaLayout', () => {
  it('detects landscape when width ≥ height', () => {
    expect(computeArenaLayout(1280, 720).orientation).toBe('landscape');
    expect(computeArenaLayout(500, 500).orientation).toBe('landscape');
  });

  it('detects portrait when height > width', () => {
    expect(computeArenaLayout(390, 844).orientation).toBe('portrait');
  });

  it('seats the boss higher in portrait than landscape', () => {
    const portrait = computeArenaLayout(390, 844).bossCenterYFraction;
    const landscape = computeArenaLayout(844, 390).bossCenterYFraction;
    expect(portrait).toBeLessThan(landscape);
  });

  it('never lets the strike radius fall below the touch-target floor', () => {
    // A tiny viewport (min dim 80 → 80·0.44 ≈ 35px) would give a sub-finger radius by fraction alone.
    const layout = computeArenaLayout(80, 160, { minTouchRadiusPx: 44 });
    expect(layout.strikeRadius).toBe(44);
  });

  it('scales the strike radius with the smaller dimension on large screens', () => {
    const layout = computeArenaLayout(1920, 1080);
    // landscape fraction 0.4 of the 1080 min dimension, well above the floor.
    expect(layout.strikeRadius).toBeCloseTo(432);
  });

  it('clamps boss scale to a sane range', () => {
    expect(computeArenaLayout(200, 200).bossScale).toBe(0.5); // floor
    expect(computeArenaLayout(4000, 4000).bossScale).toBe(1.4); // ceiling
  });

  it('gives portrait a wider HP bar fraction than landscape', () => {
    const portrait = computeArenaLayout(400, 800);
    const landscape = computeArenaLayout(800, 400);
    expect(portrait.hpBarWidth).toBeCloseTo(400 * 0.86);
    expect(landscape.hpBarWidth).toBeCloseTo(560); // min(560, 800*0.7=560)
  });

  it('handles a degenerate zero-size viewport without NaN', () => {
    const layout = computeArenaLayout(0, 0);
    expect(layout.strikeRadius).toBe(44);
    expect(Number.isFinite(layout.bossScale)).toBe(true);
    expect(layout.hpBarWidth).toBe(0);
  });
});

describe('prefersReducedMotion', () => {
  it('is true when the media query matches', () => {
    const host = { matchMedia: (_q: string) => ({ matches: true }) };
    expect(prefersReducedMotion(host)).toBe(true);
  });

  it('is false when the media query does not match', () => {
    const host = { matchMedia: (_q: string) => ({ matches: false }) };
    expect(prefersReducedMotion(host)).toBe(false);
  });

  it('defaults to false when matchMedia is unavailable', () => {
    expect(prefersReducedMotion({})).toBe(false);
  });
});
