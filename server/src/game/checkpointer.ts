import {
  type EventState,
  type EventSnapshot,
  CHECKPOINT_INTERVAL_MS,
} from '@overworld/shared';
import type { PersistenceStore } from '../state/persistence.js';

/**
 * Checkpoint / replay driver (P2-D-3 / OOM-42).
 *
 * Implements the durability schema designed in P-1 (`shared/checkpoint.ts`): Redis holds live
 * authoritative state; this module writes a durable {@link EventSnapshot} to Postgres **every 30s and
 * on every phase change**, and appends a per-tick aggregate contribution delta to the replay log so the
 * short window between the last snapshot and a crash can be reconstructed.
 *
 * It is deliberately **not** per-contribution: the replay entry is the tick's *aggregate* delta (the
 * same aggregate the tick already computes), so durability write volume stays O(tick rate), not
 * O(contributions) — the P1 constant-cost philosophy carried into persistence.
 *
 * Pure of wall-clock: the tick loop injects `now` and calls {@link onTick}; reconstruction is a free
 * function so auto-recovery (P2-X-1) can call it without a live loop.
 */

export interface CheckpointerDeps {
  persistence: PersistenceStore;
  eventId: string;
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Checkpoint cadence; defaults to the shared {@link CHECKPOINT_INTERVAL_MS} (30s). */
  intervalMs?: number;
}

export interface Checkpointer {
  /**
   * Fold one tick into the durable record: append the tick's aggregate delta to the replay log, then
   * checkpoint if the interval elapsed or the phase changed. Returns whether a checkpoint was written.
   */
  onTick(state: EventState, aggregateDelta: number): Promise<{ checkpointed: boolean }>;
  /** Force a checkpoint now (e.g. final tally at resolution). Returns the written snapshot. */
  checkpointNow(state: EventState): Promise<EventSnapshot>;
  /** The last-written checkpoint sequence number. */
  seq(): number;
}

export function createCheckpointer(deps: CheckpointerDeps): Checkpointer {
  const intervalMs = deps.intervalMs ?? CHECKPOINT_INTERVAL_MS;
  let seq = 0;
  let lastCheckpointTs: number | null = null;
  let lastPhase: EventState['phase'] | null = null;

  const checkpointNow = async (state: EventState): Promise<EventSnapshot> => {
    const takenAtTs = deps.now();
    const snapshot: EventSnapshot = { eventId: deps.eventId, seq: ++seq, state, takenAtTs };
    await deps.persistence.writeCheckpoint(snapshot);
    lastCheckpointTs = takenAtTs;
    lastPhase = state.phase;
    return snapshot;
  };

  return {
    async onTick(state, aggregateDelta) {
      const ts = deps.now();
      await deps.persistence.appendReplay({
        eventId: deps.eventId,
        ts,
        contribDelta: aggregateDelta,
      });

      const phaseChanged = lastPhase !== null && lastPhase !== state.phase;
      const intervalElapsed = lastCheckpointTs === null || ts - lastCheckpointTs >= intervalMs;
      if (phaseChanged || intervalElapsed) {
        await checkpointNow(state);
        return { checkpointed: true };
      }
      // Track phase even on ticks we don't checkpoint, so the first post-lead-in phase change fires.
      lastPhase = state.phase;
      return { checkpointed: false };
    },
    checkpointNow,
    seq: () => seq,
  };
}

/** The counter value reconstructed from the latest checkpoint + the post-snapshot replay window. */
export interface Reconstruction {
  snapshot: EventSnapshot;
  /** `snapshot.state.bossHp` with every post-snapshot replay delta re-applied. */
  reconstructedValue: number;
  /** How many replay entries were folded in. */
  appliedEntries: number;
}

/**
 * Rebuild an event's authoritative counter after a restart: take the highest-seq checkpoint and
 * re-apply every replay delta recorded after it. Returns null if the event was never checkpointed
 * (nothing to recover). Clamps the result to `[0, hpMax]` — the same bound the live counter enforces.
 */
export async function reconstructFromCheckpoint(
  persistence: PersistenceStore,
  eventId: string,
  hpMax: number,
): Promise<Reconstruction | null> {
  const snapshot = await persistence.latestCheckpoint(eventId);
  if (!snapshot) return null;

  const entries = await persistence.replaySince(eventId, snapshot.takenAtTs);
  const summed = entries.reduce((acc, e) => acc + e.contribDelta, snapshot.state.bossHp);
  const reconstructedValue = Math.min(hpMax, Math.max(0, summed));

  return { snapshot, reconstructedValue, appliedEntries: entries.length };
}
