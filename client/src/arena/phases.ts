import type { Phase } from '@overworld/shared';

/**
 * Local phase logic (P0-C-7 / OOM-23; HP→phase math promoted to `shared` in P1 / OOM-29).
 *
 * The HP-fraction thresholds now live in `shared/src/phases.ts` so the authoritative server and the
 * client agree on exactly where a boundary sits (indication `contracts-single-source-of-truth`). We
 * re-export them here for the existing client call sites, and keep the one genuinely client-side
 * concern local:
 *  - A {@link PhaseTracker} that detects when the authoritative phase *changes* between frames, so the
 *    arena can punctuate a crossing (flash, announce, camera kick) exactly once.
 *
 * No Pixi/DOM, so it is fully unit-testable in Node.
 */

export {
  PHASE_1_FLOOR,
  PHASE_2_FLOOR,
  combatPhaseForFraction,
  combatPhaseProgressPct,
} from '@overworld/shared';

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
