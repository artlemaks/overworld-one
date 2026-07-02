import { z } from 'zod';

/**
 * Event archetype abstraction (P3-S-2 / OOM-52) + the two P3 reskins (P3-P-2 Structure, P3-P-3 Threat).
 *
 * The SINGLE SOURCE OF TRUTH for how the ONE authoritative counter the server owns is *interpreted* per
 * archetype. P1 deliberately shipped a stable wire (`EventState.bossHp` — an absolute counter) and
 * forward-designed it (P1-S-2) so that Structure `height` and Threat `distance` are the *same number*
 * seen through a different lens. This module is that lens: it never changes the wire, it only tells the
 * client how to *label and direct* the counter, and tells the server the counter's magnitude and win
 * condition. No P3 migration — exactly the promise P1 made.
 *
 * ── The three archetypes ────────────────────────────────────────────────────────────────────────
 *  - `boss`      — counter is boss HP; players drive it DOWN to 0 (the P0/P1/P2 default).
 *  - `structure` — counter is remaining height-to-build; players drive it DOWN to 0 (fully built).
 *  - `threat`    — counter is distance-from-town; players drive it UP to a safe max (pushed back).
 *
 * By expressing all three as "an absolute counter with a target and a direction", the shared bar, the
 * checkpoint schema, and the tick loop are archetype-agnostic. Pure data + pure mappers; unit-testable.
 */

/** The three shipped event archetypes. */
export const Archetype = z.enum(['boss', 'structure', 'threat']);
export type Archetype = z.infer<typeof Archetype>;

/** All archetypes, in canonical order. */
export const ARCHETYPES: readonly Archetype[] = ['boss', 'structure', 'threat'];

/**
 * Which way "progress" moves the counter. `down` = players reduce it toward 0 (boss HP, structure
 * remaining); `up` = players raise it toward the target (threat pushed to a safe distance).
 */
export const CounterDirection = z.enum(['down', 'up']);
export type CounterDirection = z.infer<typeof CounterDirection>;

/**
 * Per-archetype presentation + win-condition config. `counterMax` is the same magnitude the P1 counter
 * uses; `direction` + `winAt` define completion. The `labels` are all the client needs to reskin the
 * arena without any new wire field.
 */
export const ArchetypeConfig = z.object({
  archetype: Archetype,
  direction: CounterDirection,
  /** Full magnitude of the counter (e.g. boss hpMax, structure total height, threat safe distance). */
  counterMax: z.number().positive(),
  /** The counter value that means "event complete". `down` archetypes win at 0; `up` win at counterMax. */
  winAt: z.number().nonnegative(),
  labels: z.object({
    /** e.g. "Boss HP", "Structure", "Threat". */
    counterName: z.string().min(1),
    /** Verb for a contribution, e.g. "Strike", "Build", "Push back". */
    contributeVerb: z.string().min(1),
    /** Short win banner, e.g. "Boss defeated!", "Structure complete!", "Town saved!". */
    winBanner: z.string().min(1),
  }),
});
export type ArchetypeConfig = z.infer<typeof ArchetypeConfig>;

/** The canonical config for each archetype. Counter magnitudes are the P1/P2 defaults, kept in sync. */
export const ARCHETYPE_CONFIGS: Record<Archetype, ArchetypeConfig> = {
  boss: {
    archetype: 'boss',
    direction: 'down',
    counterMax: 100_000,
    winAt: 0,
    labels: { counterName: 'Boss HP', contributeVerb: 'Strike', winBanner: 'Boss defeated!' },
  },
  structure: {
    archetype: 'structure',
    direction: 'down',
    counterMax: 100_000,
    winAt: 0,
    labels: { counterName: 'Structure', contributeVerb: 'Build', winBanner: 'Structure complete!' },
  },
  threat: {
    archetype: 'threat',
    direction: 'up',
    counterMax: 100_000,
    winAt: 100_000,
    labels: { counterName: 'Safety', contributeVerb: 'Push back', winBanner: 'Town saved!' },
  },
};

/**
 * Completion fraction (0..1) for an archetype given the raw counter value. Always 0 at the start and 1
 * at the win condition, regardless of direction — so phase logic and progress bars are archetype-blind.
 */
export function completionFraction(cfg: ArchetypeConfig, counter: number): number {
  const clamped = Math.min(cfg.counterMax, Math.max(0, counter));
  const frac = cfg.direction === 'down' ? 1 - clamped / cfg.counterMax : clamped / cfg.counterMax;
  return Math.min(1, Math.max(0, frac));
}

/** Whether the event's win condition is met for the given counter value. */
export function isArchetypeComplete(cfg: ArchetypeConfig, counter: number): boolean {
  return cfg.direction === 'down' ? counter <= cfg.winAt : counter >= cfg.winAt;
}
