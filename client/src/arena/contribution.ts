import type { ActionType } from '@overworld/shared';

/**
 * Aim-and-strike / timing mechanic (P0-C-3 / OOM-19).
 *
 * The core "ten-second contribution" action: the player aims at the boss and strikes on a rhythmic
 * beat. This module turns a raw pointer/touch input into a {@link Strike} carrying the two skill
 * signals the action rewards — how well the player *aimed* and how well they *timed* the hit.
 *
 * It deliberately stops there: it computes NO point value. The server owns scoring (P1-S-3), and even
 * the P0 local placeholder (OOM-20) is a separate consumer that maps these signals into the
 * `inputParams` of the shared `ContributionMessage`. Keeping the value out here preserves the
 * server-authoritative boundary from the very first prototype. Pure and deterministic (no clock, no
 * random) so it is fully unit-testable in Node — same discipline as `mockEvent.ts` / `loop.ts`.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** A raw input sample captured from a pointer/touch handler, in the same space as the boss centre. */
export interface StrikeInput {
  /** Pointer position when the strike was made. */
  point: Vec2;
  /** Client timestamp (epoch ms) — carried through for latency stats only, never for scoring. */
  clientTs: number;
}

/** Context a strike is resolved against: where the boss is and how forgiving the aim ring is. */
export interface StrikeContext {
  /** Centre of the boss in the same coordinate space as {@link StrikeInput.point}. */
  bossCenter: Vec2;
  /** Distance (px) at which aim accuracy reaches 0; a hit on the centre scores 1. */
  aimRadius: number;
  /** Timing accuracy in [0,1] sampled from the beat at the instant of the strike. */
  timingQuality: number;
  /** Which contribution kind this strike represents (P0 is always 'strike'). */
  actionType?: ActionType;
}

/** The resolved outcome of one strike — pure skill signals, never a score. */
export interface Strike {
  actionType: ActionType;
  /** Unit vector from the boss centre toward the strike point (zero vector if dead-centre). */
  aim: Vec2;
  /** Raw distance (px) from the boss centre to the strike point. */
  distance: number;
  /** Aim accuracy in [0,1]: 1 on the centre, 0 at/beyond `aimRadius`. */
  aimAccuracy: number;
  /** Timing accuracy in [0,1], passed through from the beat. */
  timingQuality: number;
  /** Combined skill signal in [0,1] — the geometric mean of aim and timing. */
  accuracy: number;
  clientTs: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Resolve a raw input into a {@link Strike}. Combines aim (proximity to the boss centre) with the
 * supplied timing quality. The two multiply via a geometric mean, so a great aim with terrible timing
 * (or vice versa) is a weak strike — both skills matter.
 */
export function resolveStrike(input: StrikeInput, ctx: StrikeContext): Strike {
  const dx = input.point.x - ctx.bossCenter.x;
  const dy = input.point.y - ctx.bossCenter.y;
  const distance = Math.hypot(dx, dy);

  // Unit aim vector; a dead-centre strike has no direction, so report a zero vector.
  const aim: Vec2 = distance > 0 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 0 };

  const aimAccuracy = ctx.aimRadius > 0 ? clamp01(1 - distance / ctx.aimRadius) : 0;
  const timingQuality = clamp01(ctx.timingQuality);
  const accuracy = Math.sqrt(aimAccuracy * timingQuality);

  return {
    actionType: ctx.actionType ?? 'strike',
    aim,
    distance,
    aimAccuracy,
    timingQuality,
    accuracy,
    clientTs: input.clientTs,
  };
}

/**
 * Rhythmic strike beat (the "timing" half of aim-and-strike).
 *
 * A beat pulses every `periodMs`. Striking near a pulse yields quality ~1; quality falls linearly to
 * 0 at the edge of the `windowMs` around each pulse and is 0 outside the window. Advanced by the same
 * fixed step as the rest of the sim, so the rhythm is deterministic and shared by render + logic.
 */
export interface StrikeTimingOptions {
  /** Time between beats in ms. */
  periodMs: number;
  /** Full width (ms) of the scoring window centred on each beat; must be < periodMs. */
  windowMs: number;
}

export interface StrikeTiming {
  /** Advance the beat clock by `dtMs`. */
  advance: (dtMs: number) => void;
  /** Timing quality in [0,1] at the current instant. */
  quality: () => number;
  /** Phase in [0,1) through the current beat period — for rendering the beat ring. */
  phase: () => number;
}

export function createStrikeTiming(options: StrikeTimingOptions): StrikeTiming {
  const { periodMs, windowMs } = options;
  if (periodMs <= 0) throw new Error('periodMs must be > 0');
  if (windowMs <= 0 || windowMs >= periodMs) throw new Error('windowMs must be in (0, periodMs)');

  const halfWindow = windowMs / 2;
  let clockMs = 0;

  // Shortest distance (ms) from `t` to the nearest beat (beats at 0, periodMs, 2·periodMs, ...).
  const distanceToBeat = (t: number): number => {
    const intoPeriod = ((t % periodMs) + periodMs) % periodMs;
    return Math.min(intoPeriod, periodMs - intoPeriod);
  };

  return {
    advance(dtMs: number): void {
      if (dtMs > 0) clockMs += dtMs;
    },
    quality(): number {
      const d = distanceToBeat(clockMs);
      return d >= halfWindow ? 0 : 1 - d / halfWindow;
    },
    phase(): number {
      return (((clockMs % periodMs) + periodMs) % periodMs) / periodMs;
    },
  };
}
