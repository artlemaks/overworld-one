import { describe, it, expect } from 'vitest';
import { createHeat } from './heat.js';

describe('createHeat', () => {
  it('starts cold: zero heat, no combo, neutral multiplier', () => {
    const heat = createHeat();
    expect(heat.value()).toBe(0);
    expect(heat.combo()).toBe(0);
    expect(heat.multiplier()).toBe(1);
  });

  it('builds heat and combo on each hit', () => {
    const heat = createHeat({ gainPerHit: 0.2, max: 1 });
    heat.registerHit(1);
    expect(heat.value()).toBeCloseTo(0.2);
    expect(heat.combo()).toBe(1);
    heat.registerHit(1);
    expect(heat.value()).toBeCloseTo(0.4);
    expect(heat.combo()).toBe(2);
  });

  it('scales heat gain by hit quality', () => {
    const heat = createHeat({ gainPerHit: 0.4, max: 1 });
    heat.registerHit(0.5);
    expect(heat.value()).toBeCloseTo(0.2);
  });

  it('clamps quality into [0,1]', () => {
    const heat = createHeat({ gainPerHit: 0.5, max: 1 });
    heat.registerHit(10);
    expect(heat.value()).toBeCloseTo(0.5);
    heat.registerHit(-10);
    expect(heat.value()).toBeCloseTo(0.5); // negative contributes nothing
  });

  it('caps heat and the multiplier at the ceiling', () => {
    const heat = createHeat({ gainPerHit: 1, max: 1, maxMultiplier: 2 });
    heat.registerHit(1);
    heat.registerHit(1);
    expect(heat.value()).toBe(1);
    expect(heat.multiplier()).toBe(2);
  });

  it('interpolates the multiplier linearly with heat', () => {
    const heat = createHeat({ gainPerHit: 0.5, max: 1, maxMultiplier: 3 });
    heat.registerHit(1); // heat 0.5
    expect(heat.multiplier()).toBeCloseTo(2); // 1 + (3-1)*0.5
  });

  it('cools down over time', () => {
    const heat = createHeat({ gainPerHit: 1, decayPerSec: 0.5, max: 1 });
    heat.registerHit(1);
    heat.advance(1000);
    expect(heat.value()).toBeCloseTo(0.5);
    heat.advance(2000);
    expect(heat.value()).toBe(0);
  });

  it('resets the combo after an idle window with no hits', () => {
    const heat = createHeat({ comboWindowMs: 1000 });
    heat.registerHit(1);
    heat.registerHit(1);
    expect(heat.combo()).toBe(2);
    heat.advance(999);
    expect(heat.combo()).toBe(2); // still within the window
    heat.advance(1);
    expect(heat.combo()).toBe(0); // window elapsed
  });

  it('keeps the combo alive when hits land inside the window', () => {
    const heat = createHeat({ comboWindowMs: 1000 });
    heat.registerHit(1);
    heat.advance(800);
    heat.registerHit(1); // resets idle timer
    heat.advance(800);
    expect(heat.combo()).toBe(2);
  });

  it('reset returns to a cold state', () => {
    const heat = createHeat();
    heat.registerHit(1);
    heat.reset();
    expect(heat.value()).toBe(0);
    expect(heat.combo()).toBe(0);
    expect(heat.multiplier()).toBe(1);
  });

  it('the multiplier depends only on skill input, never on a purchase/pass parameter', () => {
    // There is no tier/purchase argument in the API — same hits yield the same multiplier every time.
    const a = createHeat();
    const b = createHeat();
    a.registerHit(0.7);
    b.registerHit(0.7);
    expect(a.multiplier()).toBe(b.multiplier());
  });

  it('rejects a non-positive max', () => {
    expect(() => createHeat({ max: 0 })).toThrow();
  });
});
