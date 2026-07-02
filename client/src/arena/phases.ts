import type { Phase } from '@overworld/shared';

/**
 * Local phase logic (P0-C-7 / OOM-23).
 *
 * Two concerns, both pure:
 *  1. The HP-fraction thresholds that split active combat into `phase-1/2/3`, extracted here as the
 *     single source so the mock event driver and anyone else agree on where a phase boundary is.
 *  2. A {@link PhaseTracker} that detects when the authoritative phase *changes* between frames, so
 *     the arena can punctuate a crossing (flash, announce, camera kick) exactly once.
 *
 * The phase names themselves stay owned by the shared `Phase` enum (indication
 * `contracts-single-source-of-truth`); this module only decides *when* combat sits in each and *when*
 * a boundary is crossed. No Pixi/DOM, so it is fully unit-testable in Node.
 */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** HP fraction at/below which combat leaves phase-1, and phase-2. Combat splits into equal thirds. */
export const PHASE_1_FLOOR = 2 / 3;
export const PHASE_2_FLOOR = 1 / 3;
const THIRD = 1 / 3;

/**
 * The combat phase for a given boss HP fraction (0..1). Only the three *combat* phases are HP-driven;
 * `pending` (lead-in) and `resolving`/`resolved` (post-kill) are timing-driven and owned by the event
 * driver, not by this mapping.
 */
export function combatPhaseForFraction(fraction: number): Phase {
  const f = clamp01(fraction);
  if (f > PHASE_1_FLOOR) return 'phase-1';
  if (f > PHASE_2_FLOOR) return 'phase-2';
  return 'phase-3';
}

/** Progress in [0,100] through the current combat phase, given the boss HP fraction. */
export function combatPhaseProgressPct(fraction: number): number {
  const f = clamp01(fraction);
  const into = f > PHASE_1_FLOOR ? 1 - f : f > PHASE_2_FLOOR ? PHASE_1_FLOOR - f : PHASE_2_FLOOR - f;
  return Math.min(100, Math.max(0, (into / THIRD) * 100));
}

export interface PhaseTransition {
  from: Phase;
  to: Phase;
}

export interface PhaseTracker {
  /**
   * Feed the current authoritative phase. Returns a {@link PhaseTransition} the first frame it differs
   * from the previously seen phase, otherwise `null`. The very first observation never reports a
   * transition (there is nothing to cross from).
   */
  update: (phase: Phase) => PhaseTransition | null;
  /** The last observed phase, or `null` before the first `update`. */
  current: () => Phase | null;
}

export function createPhaseTracker(initial?: Phase): PhaseTracker {
  let last: Phase | null = initial ?? null;

  return {
    update(phase) {
      if (last === null) {
        last = phase;
        return null;
      }
      if (phase === last) return null;
      const transition: PhaseTransition = { from: last, to: phase };
      last = phase;
      return transition;
    },
    current() {
      return last;
    },
  };
}
