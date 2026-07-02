import { z } from 'zod';

/**
 * Full-event-loop contracts (P2 / OOM-4).
 *
 * The SINGLE SOURCE OF TRUTH for everything the P2 loop adds on top of the P1 real-time core: the
 * authoritative lifecycle status, reward tiers, commemoratives, and the per-player resolution summary
 * the client renders. Defined once here and imported by both `/server` and `/client`
 * (indication `contracts-single-source-of-truth`) so a resolution screen can never disagree with the
 * server about what a tier or a commemorative is.
 *
 * Note the deliberate split between two orthogonal notions the P1 wire already conflated in spirit:
 *  - {@link LifecycleStatus} — the high-level, server-authoritative event FSM state (P2-S-1).
 *  - the combat `Phase` (in `contracts.ts`) — the HP-driven *display* sub-state *within* `active`.
 * The FSM owns pending→active→resolving→resolved/failed; the combat phase only means something while
 * the FSM is `active`.
 */

/**
 * The authoritative event lifecycle state (P2-S-1). Transitions are server-driven and one-way through
 * the happy path; `failed` is reachable from any non-terminal state (window expiry / forced recovery).
 */
export const LifecycleStatus = z.enum([
  /** Lead-in ("Get Ready"); the counter exists but the objective clock hasn't opened. */
  'pending',
  /** Combat underway — the wire `Phase` (phase-1/2/3) is meaningful only here. */
  'active',
  /** Objective met, or the window closed; the "Finishing Blow" beat before rewards. */
  'resolving',
  /** Completed successfully; tallies checkpointed and rewards granted. */
  'resolved',
  /** Window expired without completion, or force-resolved during auto-recovery. */
  'failed',
]);
export type LifecycleStatus = z.infer<typeof LifecycleStatus>;

/** The two terminal states — no transition leaves either. */
export const TERMINAL_STATUSES: readonly LifecycleStatus[] = ['resolved', 'failed'];

/** Whether a lifecycle status is terminal (event is over). */
export function isTerminalStatus(status: LifecycleStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Outcome of a finished event, as shown to players. */
export const EventOutcome = z.enum(['completed', 'failed']);
export type EventOutcome = z.infer<typeof EventOutcome>;

/** Reward tier a participant earned, by their share of total contribution. `none` = did not qualify. */
export const Tier = z.enum(['none', 'bronze', 'silver', 'gold', 'legendary']);
export type Tier = z.infer<typeof Tier>;

/** Rarity of a commemorative badge (P2-P-1). */
export const CommemorativeRarity = z.enum(['common', 'rare', 'epic', 'legendary']);
export type CommemorativeRarity = z.infer<typeof CommemorativeRarity>;

/**
 * A time-limited commemorative granted at resolution (P2-P-1). `expiresAtTs` encodes the FOMO
 * mechanic — a badge that visibly lapses — while `null` marks a permanent keepsake.
 */
export const Commemorative = z.object({
  commemorativeId: z.string().min(1),
  eventId: z.string().min(1),
  rarity: CommemorativeRarity,
  earnedAtTs: z.number().int().nonnegative(),
  /** Event-scoped expiry (epoch ms); `null` = never expires. */
  expiresAtTs: z.number().int().nonnegative().nullable(),
});
export type Commemorative = z.infer<typeof Commemorative>;

/**
 * Per-player resolution summary (P2-S-4) — the exact payload the resolution screen (P2-C-1) renders:
 * outcome, tier, what they contributed, XP earned, any commemorative, and the countdown to the next
 * event.
 */
export const PlayerResolution = z.object({
  eventId: z.string().min(1),
  playerId: z.string().min(1),
  outcome: EventOutcome,
  tier: Tier,
  /** Authoritative points this player contributed across the event. */
  contributionTotal: z.number().nonnegative(),
  /** Event XP earned (already combo-scaled + capped server-side, P2-S-3). */
  xpEarned: z.number().int().nonnegative(),
  /** The commemorative granted, or `null` if the player's tier earned none. */
  commemorative: Commemorative.nullable(),
  /** ms until the next event opens, for the resolution-screen countdown. */
  nextEventInMs: z.number().int().nonnegative(),
});
export type PlayerResolution = z.infer<typeof PlayerResolution>;
