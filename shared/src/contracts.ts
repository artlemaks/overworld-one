import { z } from 'zod';

/**
 * Shared real-time contracts (P1F-S-1 / OOM-13).
 *
 * These schemas are the SINGLE SOURCE OF TRUTH for the client<->server wire protocol.
 * Define once here, import on both sides — never redeclare a message shape in /client or
 * /server. See indication `contracts-single-source-of-truth`.
 */

/** Kinds of contribution a player can make. Extended per event archetype (P3). */
export const ActionType = z.enum(['strike', 'support', 'rally']);
export type ActionType = z.infer<typeof ActionType>;

/** Event phase label. Server-authoritative; clients render what they are told. */
export const Phase = z.enum(['pending', 'phase-1', 'phase-2', 'phase-3', 'resolving', 'resolved']);
export type Phase = z.infer<typeof Phase>;

/**
 * Client -> server: a single contribution.
 * The server computes the point value (P1-S-3); the client never asserts its own score.
 */
export const ContributionMessage = z.object({
  playerId: z.string().min(1),
  actionType: ActionType,
  /** Opaque per-action input (aim vector, timing offset, etc.); validated server-side. */
  inputParams: z.record(z.string(), z.number()).default({}),
  /** Client-side timestamp (epoch ms) — used only for latency stats, never for scoring. */
  clientTs: z.number().int().nonnegative(),
});
export type ContributionMessage = z.infer<typeof ContributionMessage>;

/**
 * Authoritative event state.
 * Forward-designed (P1-S-2): `bossHp` generalises to Structure `height` / Threat `distance`
 * via the reskin layer in P3 — the wire shape stays stable.
 */
export const EventState = z.object({
  bossHp: z.number().min(0),
  phase: Phase,
  /** 0..100 progress within the current phase. */
  phaseProgressPct: z.number().min(0).max(100),
  /** Count of contribution waves aggregated in the last tick window. */
  contribWaveCount: z.number().int().nonnegative(),
  /** Aggregate presence — sampled, never per-player positions (P1-S-7). */
  playersContributingNow: z.number().int().nonnegative(),
});
export type EventState = z.infer<typeof EventState>;

/** Rolling aggregate stats sampled into each tick (P1-S-5). */
export const AggregateStats = z.object({
  /** Total contribution delta applied across all players in the tick window. */
  contribDelta: z.number(),
  /** Contributions per second, sampled. */
  contribRate: z.number().nonnegative(),
});
export type AggregateStats = z.infer<typeof AggregateStats>;

/**
 * Server -> client: one tick snapshot.
 * Per-client bandwidth is constant regardless of player count (P1 DoD) because this payload
 * carries aggregates, not per-player data.
 */
export const TickSnapshot = z.object({
  eventState: EventState,
  aggregateStats: AggregateStats,
  /** Server timestamp (epoch ms) — authoritative clock. */
  serverTs: z.number().int().nonnegative(),
});
export type TickSnapshot = z.infer<typeof TickSnapshot>;
