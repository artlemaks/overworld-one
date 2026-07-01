/**
 * Fixed-timestep game loop (P0-C-1 / OOM-17).
 *
 * Decouples simulation from rendering: `update(stepMs)` runs at a fixed cadence (deterministic —
 * the basis for the contribution/combo mechanics in OOM-19/22), while `render(alpha)` runs once per
 * frame with an interpolation factor. Pure (no Pixi/DOM) so it is fully unit-testable; the Pixi
 * ticker just feeds it `deltaMS`.
 */

export interface FixedLoopOptions {
  /** Fixed simulation step in ms (e.g. 1000/60 for 60 Hz). */
  stepMs: number;
  /** Max simulation steps per frame — prevents the "spiral of death" on a long stall. */
  maxSubSteps?: number;
  /** Advance the simulation by exactly `stepMs`. */
  update: (stepMs: number) => void;
  /** Draw the current state; `alpha` in [0,1) interpolates toward the next step. */
  render?: (alpha: number) => void;
}

export interface FixedLoop {
  /** Feed elapsed wall-clock ms (from the ticker); runs 0..maxSubSteps updates then one render. */
  advance: (elapsedMs: number) => void;
  /** Clear the accumulator (e.g. after a pause) to avoid a burst of catch-up steps. */
  reset: () => void;
}

export function createFixedLoop(opts: FixedLoopOptions): FixedLoop {
  const { stepMs, update, render } = opts;
  const maxSubSteps = opts.maxSubSteps ?? 5;
  if (stepMs <= 0) throw new Error('stepMs must be > 0');

  let accumulator = 0;

  return {
    advance(elapsedMs: number) {
      if (elapsedMs > 0) accumulator += elapsedMs;

      let steps = 0;
      while (accumulator >= stepMs && steps < maxSubSteps) {
        update(stepMs);
        accumulator -= stepMs;
        steps += 1;
      }

      // Clamped by maxSubSteps → drop the backlog so we don't spiral trying to catch up.
      if (steps === maxSubSteps && accumulator >= stepMs) accumulator = 0;

      render?.(accumulator / stepMs);
    },
    reset() {
      accumulator = 0;
    },
  };
}
