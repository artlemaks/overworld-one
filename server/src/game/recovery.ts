import { type LifecycleStatus, AUTO_RECOVERY_MAX_GAP_MS } from '@overworld/shared';
import type { CounterStore } from '../state/counters.js';
import type { ParticipantStore } from '../state/participants.js';
import type { PersistenceStore, CounterDirection } from '../state/persistence.js';
import { reconstructFromCheckpoint } from './checkpointer.js';
import { lifecycleStatusForPhase } from './lifecycle.js';
import { resolveEvent } from './resolution.js';

/**
 * Event auto-recovery (P2-X-1 / OOM-44).
 *
 * On server load there may be a checkpointed event mid-flight (a crash or redeploy). This decides, with
 * **no manual state editing**, one of three actions:
 *
 *  - **fresh-start** — nothing was ever checkpointed; begin a new event.
 *  - **resumed** — the last checkpoint is recent (within `AUTO_RECOVERY_MAX_GAP_MS` ≈ 5 min): rebuild
 *    the authoritative counter from checkpoint + replay window and restore the lifecycle status, so the
 *    event continues where it left off (within the ≤60s loss window the checkpoint schema guarantees).
 *  - **force-resolved** — the gap is too large to resume credibly: force-resolve the stale event as
 *    `failed` (granting participation rewards for what *was* recorded) and start fresh.
 *
 * Orchestrates the injected seams; the *policy* (which action) is a pure function of the gap so it is
 * directly unit-testable.
 */

export type RecoveryAction = 'fresh-start' | 'resumed' | 'force-resolved';

export interface RecoveryResult {
  action: RecoveryAction;
  /** For `resumed`: the counter value the event resumes at. */
  reconstructedValue?: number;
  /** For `resumed`: the lifecycle status restored from the checkpoint. */
  status?: LifecycleStatus;
  /** For `resumed`: how many replay entries were folded past the checkpoint. */
  appliedEntries?: number;
  /** For `force-resolved`: how many players the stale event was resolved for. */
  resolvedPlayers?: number;
}

export interface RecoveryDeps {
  persistence: PersistenceStore;
  counterStore: CounterStore;
  participants: ParticipantStore;
  /** Injectable clock (epoch ms). */
  now: () => number;
}

export interface RecoveryParams {
  eventId: string;
  hpMax: number;
  direction: CounterDirection;
  startedAtTs: number;
  /** ms until the *next* event opens (echoed on any force-resolution payloads). */
  nextEventInMs: number;
  /** Max gap since the last checkpoint to still resume; defaults to the shared 5-min bound. */
  maxGapMs?: number;
}

/** Whether a checkpoint that old (gap ms) is recent enough to resume from. Pure policy. */
export function canResume(gapMs: number, maxGapMs: number = AUTO_RECOVERY_MAX_GAP_MS): boolean {
  return gapMs <= maxGapMs;
}

export async function recoverEvent(
  deps: RecoveryDeps,
  params: RecoveryParams,
): Promise<RecoveryResult> {
  const maxGapMs = params.maxGapMs ?? AUTO_RECOVERY_MAX_GAP_MS;

  const snapshot = await deps.persistence.latestCheckpoint(params.eventId);
  if (!snapshot) return { action: 'fresh-start' };

  const gapMs = deps.now() - snapshot.takenAtTs;

  if (canResume(gapMs, maxGapMs)) {
    const recon = await reconstructFromCheckpoint(deps.persistence, params.eventId, params.hpMax);
    // `recon` is non-null here — we already have a snapshot.
    const reconstructedValue = recon?.reconstructedValue ?? snapshot.state.bossHp;
    await deps.counterStore.init({
      eventId: params.eventId,
      initial: reconstructedValue,
      floor: 0,
      ceil: params.hpMax,
    });
    return {
      action: 'resumed',
      reconstructedValue,
      status: lifecycleStatusForPhase(snapshot.state.phase),
      appliedEntries: recon?.appliedEntries ?? 0,
    };
  }

  // Too stale to resume: force-resolve the prior event as failed, then reset for a fresh one.
  const resolved = await resolveEvent(
    { participants: deps.participants, persistence: deps.persistence, now: deps.now },
    {
      eventId: params.eventId,
      outcome: 'failed',
      hpMax: params.hpMax,
      direction: params.direction,
      startedAtTs: params.startedAtTs,
      nextEventInMs: params.nextEventInMs,
    },
  );
  await deps.participants.reset(params.eventId);
  await deps.counterStore.init({
    eventId: params.eventId,
    initial: params.direction === 'down' ? params.hpMax : 0,
    floor: 0,
    ceil: params.hpMax,
  });

  return { action: 'force-resolved', resolvedPlayers: resolved.length };
}
