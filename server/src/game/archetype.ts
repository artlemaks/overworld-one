import {
  type ArchetypeConfig,
  type EventState,
  completionFraction,
  isArchetypeComplete,
  combatPhaseForFraction,
  combatPhaseProgressPct,
} from '@overworld/shared';

/**
 * Server-side archetype counter mechanics (P3-S-2 / OOM-52) + the two reskins
 * (P3-P-2 Structure / OOM-54, P3-P-3 Threat / OOM-55).
 *
 * The server owns exactly ONE authoritative counter per event; the shared {@link ArchetypeConfig}
 * (the "lens", `@overworld/shared`) says how to *interpret* it per archetype. This module is the
 * server half of that promise: it advances the counter toward the win condition respecting the
 * archetype's `direction`, reports completion, and — critically — projects any archetype's raw
 * counter onto the STABLE, archetype-blind wire {@link EventState} (P1-S-2). The wire never learns
 * which archetype it is: `bossHp` always carries the raw counter, and `phase`/`phaseProgressPct`
 * are derived from the archetype-normalised *remaining* fraction, so the `boss` archetype behaves
 * bit-for-bit like the P0/P1/P2 HP model while `structure`/`threat` ride the same rails.
 *
 * Pure: no clock, no randomness, no I/O. Fully unit-testable in Node.
 */

/** Aggregate presence sampled for the current tick — copied straight onto the wire snapshot. */
export interface ContributionPresence {
  /** Count of contribution waves aggregated in the last tick window. */
  contribWaveCount: number;
  /** Aggregate presence — sampled, never per-player positions (P1-S-7). */
  playersContributingNow: number;
}

const clampCounter = (cfg: ArchetypeConfig, value: number): number =>
  Math.min(cfg.counterMax, Math.max(0, value));

/**
 * Apply a contribution of the given `magnitude` to the raw counter, moving it toward the win
 * condition per `cfg.direction`: `down` subtracts (toward 0), `up` adds (toward `counterMax`).
 * The result is always clamped to `[0, counterMax]`.
 */
export function applyContribution(cfg: ArchetypeConfig, counter: number, magnitude: number): number {
  const next = cfg.direction === 'down' ? counter - magnitude : counter + magnitude;
  return clampCounter(cfg, next);
}

/**
 * Completion for the current raw counter — the normalised fraction (0 at start, 1 at the win
 * condition) and whether the win condition is met. Delegates to the shared source of truth so the
 * server and client never disagree on "done".
 */
export function archetypeCompletion(
  cfg: ArchetypeConfig,
  counter: number,
): { fraction: number; complete: boolean } {
  return {
    fraction: completionFraction(cfg, counter),
    complete: isArchetypeComplete(cfg, counter),
  };
}

/**
 * Project any archetype's raw counter onto the stable wire {@link EventState}.
 *
 * `bossHp` carries the raw counter unchanged — the wire is archetype-blind (P1-S-2). `phase` and
 * `phaseProgressPct` are derived by feeding the REMAINING fraction (`1 - completionFraction`) into
 * the shared combat-phase mapping, so the `boss` archetype (`down`, from `counterMax` to 0)
 * reproduces the original HP model exactly, and `structure`/`threat` reuse the identical phase rails.
 */
export function counterToEventState(
  cfg: ArchetypeConfig,
  counter: number,
  presence: ContributionPresence,
): EventState {
  const remainingFraction = 1 - completionFraction(cfg, counter);
  return {
    bossHp: counter,
    phase: combatPhaseForFraction(remainingFraction),
    phaseProgressPct: combatPhaseProgressPct(remainingFraction),
    contribWaveCount: presence.contribWaveCount,
    playersContributingNow: presence.playersContributingNow,
  };
}
