import { z } from 'zod';
import { EventState } from './contracts.js';

/**
 * Checkpoint / replay schema design (P1F-D-1 / OOM-14).
 *
 * Redis holds live authoritative state; this schema defines how that state is durably
 * snapshotted to Postgres and how the short replay window is reconstructed after a restart.
 * Implemented in P2 (P2-D-3) — designed here so P1 load-testing and P2 build aren't blocked.
 */

/** How often a checkpoint is written, and the replay window that bounds data loss. */
export const CHECKPOINT_INTERVAL_MS = 30_000;
/** A checkpoint is also forced on every phase change. */
export const CHECKPOINT_ON_PHASE_CHANGE = true;
/** Replay reconstructs at most this much recent history from the append-only log. */
export const REPLAY_WINDOW_MS = 60_000;
/** Auto-recovery resumes from the latest checkpoint only if within this heartbeat gap (P2-X-1). */
export const AUTO_RECOVERY_MAX_GAP_MS = 5 * 60_000;

/** A durable point-in-time snapshot of an event, written Redis -> Postgres. */
export const EventSnapshot = z.object({
  eventId: z.string().min(1),
  /** Monotonic checkpoint sequence for this event; higher wins on recovery. */
  seq: z.number().int().nonnegative(),
  state: EventState,
  /** Server time the snapshot was taken (epoch ms). */
  takenAtTs: z.number().int().nonnegative(),
});
export type EventSnapshot = z.infer<typeof EventSnapshot>;

/** One entry in the append-only replay log covering the REPLAY_WINDOW_MS window. */
export const ReplayLogEntry = z.object({
  eventId: z.string().min(1),
  /** Ordering key within the window (epoch ms). */
  ts: z.number().int().nonnegative(),
  /** Aggregate contribution delta applied at this step (not per-player). */
  contribDelta: z.number(),
});
export type ReplayLogEntry = z.infer<typeof ReplayLogEntry>;
