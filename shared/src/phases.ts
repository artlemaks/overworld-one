import type { Phase } from './contracts.js';

/**
 * Shared phase logic (promoted from the client in P1 / OOM-29).
 *
 * The HP-fraction thresholds that split active combat into `phase-1/2/3` live here so that the
 * **authoritative server** (which owns phase, P1) and the client render/mock code agree on exactly
 * where a phase boundary sits — a single source of truth, never redeclared on either side
 * (indication `contracts-single-source-of-truth`). The phase *names* stay owned by the `Phase` enum
 * in `contracts.ts`; this module only decides *which* combat phase an HP fraction falls in and how
 * far through it that fraction sits. Pure (no clock/random), so fully unit-testable in Node.
 *
 * `pending` (lead-in) and `resolving`/`resolved` (post-kill) are timing-driven, not HP-driven, and
 * are owned by the event state machine — not by this mapping.
 */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** HP fraction at/below which combat leaves phase-1, then phase-2. Combat splits into equal thirds. */
export const PHASE_1_FLOOR = 2 / 3;
export const PHASE_2_FLOOR = 1 / 3;
const THIRD = 1 / 3;

/** The combat phase for a given boss HP fraction (0..1). */
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
