import type { EventState, Phase } from '@overworld/shared';

/**
 * Arena scene view-model (P0-C-2 / OOM-18).
 *
 * Pure mapping from the authoritative {@link EventState} wire contract to the handful of numbers and
 * strings the Pixi scene needs to draw. No Pixi/DOM here so it is fully unit-testable in Node — the
 * scene stays a thin renderer (indication `client-screens-pure-and-testable`). The boss shape itself
 * is never redeclared; we consume `shared` (indication `contracts-single-source-of-truth`).
 */

/** Human-facing copy for each authoritative phase. Clients render what they are told. */
export const PHASE_LABELS: Record<Phase, string> = {
  pending: 'Get Ready',
  'phase-1': 'Phase 1',
  'phase-2': 'Phase 2',
  'phase-3': 'Phase 3',
  resolving: 'Finishing Blow',
  resolved: 'Victory',
};

/** Everything the scene draws for one frame, derived from a tick's {@link EventState}. */
export interface ArenaView {
  /** Boss HP as a fraction of its max, clamped to [0, 1] for a safe bar width. */
  hpFraction: number;
  /** Display copy for the HP bar, e.g. "740 / 1000". */
  hpText: string;
  /** Human-facing phase name. */
  phaseLabel: string;
  /** 0..100 progress within the current phase. */
  phaseProgressPct: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Map an authoritative {@link EventState} to a renderable {@link ArenaView}.
 *
 * `bossHpMax` is a client-side constant: the wire contract carries only the absolute `bossHp`
 * (it generalises to Structure height / Threat distance in P3), so the max needed to draw a bar
 * fraction lives here on the render side.
 */
export function toArenaView(state: EventState, bossHpMax: number): ArenaView {
  const hp = Math.max(0, state.bossHp);
  const hpFraction = bossHpMax > 0 ? clamp01(hp / bossHpMax) : 0;
  return {
    hpFraction,
    hpText: `${Math.ceil(hp)} / ${bossHpMax}`,
    phaseLabel: PHASE_LABELS[state.phase],
    phaseProgressPct: state.phaseProgressPct,
  };
}
