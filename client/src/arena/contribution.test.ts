import { describe, it, expect } from 'vitest';
import { resolveStrike, createStrikeTiming, type StrikeContext } from './contribution.js';

const CENTER = { x: 100, y: 100 };

/** A permissive context: perfect timing, generous aim radius, boss at CENTER. */
function context(overrides: Partial<StrikeContext> = {}): StrikeContext {
  return { bossCenter: CENTER, aimRadius: 100, timingQuality: 1, ...overrides };
}

describe('resolveStrike', () => {
  it('defaults to a strike action', () => {
    const strike = resolveStrike({ point: CENTER, clientTs: 5 }, context());
    expect(strike.actionType).toBe('strike');
    expect(strike.clientTs).toBe(5);
  });

  it('reports a zero aim vector for a dead-centre hit and full aim accuracy', () => {
    const strike = resolveStrike({ point: CENTER, clientTs: 0 }, context());
    expect(strike.aim).toEqual({ x: 0, y: 0 });
    expect(strike.distance).toBe(0);
    expect(strike.aimAccuracy).toBe(1);
  });

  it('produces a unit aim vector pointing from the boss toward the strike point', () => {
    // Strike 30px right, 40px down → distance 50, unit vector (0.6, 0.8).
    const strike = resolveStrike({ point: { x: 130, y: 140 }, clientTs: 0 }, context());
    expect(strike.distance).toBeCloseTo(50);
    expect(strike.aim.x).toBeCloseTo(0.6);
    expect(strike.aim.y).toBeCloseTo(0.8);
    expect(Math.hypot(strike.aim.x, strike.aim.y)).toBeCloseTo(1);
  });

  it('falls to zero aim accuracy at or beyond the aim radius', () => {
    const atEdge = resolveStrike({ point: { x: 200, y: 100 }, clientTs: 0 }, context());
    expect(atEdge.aimAccuracy).toBeCloseTo(0);
    const beyond = resolveStrike({ point: { x: 400, y: 100 }, clientTs: 0 }, context());
    expect(beyond.aimAccuracy).toBe(0);
  });

  it('combines aim and timing as a geometric mean', () => {
    // aimAccuracy 0.5 (50px into a 100px radius) × timingQuality 0.5 → sqrt(0.25) = 0.5.
    const strike = resolveStrike(
      { point: { x: 150, y: 100 }, clientTs: 0 },
      context({ timingQuality: 0.5 }),
    );
    expect(strike.aimAccuracy).toBeCloseTo(0.5);
    expect(strike.timingQuality).toBeCloseTo(0.5);
    expect(strike.accuracy).toBeCloseTo(0.5);
  });

  it('zeroes accuracy when either signal is zero', () => {
    const badTiming = resolveStrike({ point: CENTER, clientTs: 0 }, context({ timingQuality: 0 }));
    expect(badTiming.accuracy).toBe(0);
    const badAim = resolveStrike({ point: { x: 300, y: 100 }, clientTs: 0 }, context());
    expect(badAim.accuracy).toBe(0);
  });

  it('clamps a timing quality supplied outside [0,1]', () => {
    const strike = resolveStrike({ point: CENTER, clientTs: 0 }, context({ timingQuality: 5 }));
    expect(strike.timingQuality).toBe(1);
  });

  it('treats a non-positive aim radius as unaimable', () => {
    const strike = resolveStrike({ point: CENTER, clientTs: 0 }, context({ aimRadius: 0 }));
    expect(strike.aimAccuracy).toBe(0);
    expect(strike.accuracy).toBe(0);
  });
});

describe('createStrikeTiming', () => {
  it('rejects a non-positive period', () => {
    expect(() => createStrikeTiming({ periodMs: 0, windowMs: 10 })).toThrow();
  });

  it('rejects a window that is not inside the period', () => {
    expect(() => createStrikeTiming({ periodMs: 100, windowMs: 0 })).toThrow();
    expect(() => createStrikeTiming({ periodMs: 100, windowMs: 100 })).toThrow();
  });

  it('scores maximum quality on the beat', () => {
    const timing = createStrikeTiming({ periodMs: 1000, windowMs: 200 });
    // Clock starts at a beat (t=0).
    expect(timing.quality()).toBeCloseTo(1);
  });

  it('decays linearly to zero at the window edge', () => {
    const timing = createStrikeTiming({ periodMs: 1000, windowMs: 200 });
    timing.advance(50); // halfway to the 100ms half-window
    expect(timing.quality()).toBeCloseTo(0.5);
    timing.advance(50); // exactly at the edge
    expect(timing.quality()).toBeCloseTo(0);
  });

  it('scores zero outside the window', () => {
    const timing = createStrikeTiming({ periodMs: 1000, windowMs: 200 });
    timing.advance(300); // well past the 100ms half-window, before the next beat
    expect(timing.quality()).toBe(0);
  });

  it('rewards timing again on the next beat', () => {
    const timing = createStrikeTiming({ periodMs: 1000, windowMs: 200 });
    timing.advance(1000); // full period → back on a beat
    expect(timing.quality()).toBeCloseTo(1);
  });

  it('reports phase progressing through the period', () => {
    const timing = createStrikeTiming({ periodMs: 1000, windowMs: 200 });
    expect(timing.phase()).toBeCloseTo(0);
    timing.advance(250);
    expect(timing.phase()).toBeCloseTo(0.25);
    timing.advance(750);
    expect(timing.phase()).toBeCloseTo(0);
  });
});
