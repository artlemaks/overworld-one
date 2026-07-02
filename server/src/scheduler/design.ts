import { z } from 'zod';

/**
 * Off-peak / slow-event scheduler DESIGN (P1-X-3 / OOM-35).
 *
 * This is a **design** task, not an implementation — the scheduler itself lands in P3 (P3-X-1/2). Its
 * purpose here is to validate, architecturally and *now*, that the "empty arena" HIGH risk has a
 * concrete answer before P1's load model is built on top. What P1 commits to is the *shape*: the
 * config schema below and the async job-queue interface P3 will implement against. Types + Zod schemas
 * (compile-checked, importable) are the deliverable; there is intentionally no live scheduler wired.
 *
 * ── The empty-arena problem ────────────────────────────────────────────────────────────────────
 * A shared-objective game is dead if a player joins to an empty arena. The mitigation is two-layered:
 *   1. **Always-on slow event** — at low CCU a long, gently-paced event is *always* live, so there is
 *      always something to contribute to (implemented P3-X-2 against {@link SlowEventConfig}).
 *   2. **Scheduled marquee events** — higher-intensity events on a cadence for peak hours
 *      (implemented P3-X-1 against {@link ScheduledEventConfig}).
 * The switch between them is driven by sampled CCU (the aggregate presence P1-S-7 already produces),
 * per {@link EmptyArenaPolicy}.
 *
 * ── Why an async job queue ─────────────────────────────────────────────────────────────────────
 * Event start/stop/phase-advance must survive a node restart and run unattended, so they are modelled
 * as durable jobs on a queue (Redis-backed in P3), not in-memory timers. The {@link JobQueue}
 * interface captures exactly the operations P3 needs; keeping it here lets P2's checkpoint work and
 * P3's scheduler agree on the contract in advance.
 */

/** Pacing band for an event — how aggressively its target-completion window is enforced. */
export const PacingBand = z.enum(['slow', 'standard', 'marquee']);
export type PacingBand = z.infer<typeof PacingBand>;

/** The always-on, low-intensity event that keeps the arena non-empty off-peak. */
export const SlowEventConfig = z.object({
  archetype: z.enum(['boss', 'structure', 'threat']).default('boss'),
  /** Deliberately long window so a trickle of players can still complete it. */
  targetCompletionMs: z.number().int().positive().default(6 * 60 * 60 * 1000),
  pacing: PacingBand.default('slow'),
  /** Counter magnitude scaled down so low CCU still makes visible progress. */
  hpMax: z.number().positive().default(50_000),
});
export type SlowEventConfig = z.infer<typeof SlowEventConfig>;

/** A marquee event placed on the schedule for peak hours. */
export const ScheduledEventConfig = z.object({
  archetype: z.enum(['boss', 'structure', 'threat']),
  /** Cron-like cadence string, resolved by the P3 scheduler. */
  cadence: z.string().min(1),
  durationMs: z.number().int().positive(),
  pacing: PacingBand.default('marquee'),
  hpMax: z.number().positive(),
});
export type ScheduledEventConfig = z.infer<typeof ScheduledEventConfig>;

/** Rule for switching between the always-on slow event and scheduled marquee events. */
export const EmptyArenaPolicy = z.object({
  /** Below this sampled CCU, guarantee the slow event is live. */
  slowEventBelowCcu: z.number().int().nonnegative().default(20),
  /** Re-evaluate the policy this often. */
  evaluateEveryMs: z.number().int().positive().default(30_000),
});
export type EmptyArenaPolicy = z.infer<typeof EmptyArenaPolicy>;

/** Kinds of durable job the scheduler enqueues. */
export const JobKind = z.enum(['start-event', 'advance-phase', 'resolve-event', 'ensure-slow-event']);
export type JobKind = z.infer<typeof JobKind>;

export const ScheduledJob = z.object({
  id: z.string().min(1),
  kind: JobKind,
  /** Epoch ms at which the job becomes due. */
  runAtTs: z.number().int().nonnegative(),
  /** Opaque per-kind payload (event config, event id, …). */
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type ScheduledJob = z.infer<typeof ScheduledJob>;

/**
 * Durable async job queue the P3 scheduler implements (Redis-backed). Declared here so the contract is
 * fixed before implementation; there is no in-memory default in P1 by design.
 */
export interface JobQueue {
  /** Enqueue a job to run at or after `runAtTs`. */
  enqueue(job: ScheduledJob): Promise<void>;
  /** Claim all jobs due at/before `nowTs`, atomically (so two nodes don't double-run one). */
  claimDue(nowTs: number): Promise<ScheduledJob[]>;
  /** Acknowledge completion (or failure → optional requeue). */
  ack(jobId: string): Promise<void>;
}
