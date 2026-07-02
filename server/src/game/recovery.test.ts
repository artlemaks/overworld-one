import { describe, it, expect } from 'vitest';
import { recoverEvent, canResume, type RecoveryDeps, type RecoveryParams } from './recovery.js';
import { createCheckpointer } from './checkpointer.js';
import { createMemoryPersistence } from '../state/persistence.js';
import { createMemoryCounterStore } from '../state/counters.js';
import { createMemoryParticipantStore } from '../state/participants.js';
import { AUTO_RECOVERY_MAX_GAP_MS, type EventState } from '@overworld/shared';

const EVENT = 'evt-1';

const state = (over: Partial<EventState> = {}): EventState => ({
  bossHp: 600,
  phase: 'phase-2',
  phaseProgressPct: 0,
  contribWaveCount: 0,
  playersContributingNow: 0,
  ...over,
});

function harness(nowTs: number) {
  let t = nowTs;
  const persistence = createMemoryPersistence();
  const counterStore = createMemoryCounterStore();
  const participants = createMemoryParticipantStore();
  const deps: RecoveryDeps = { persistence, counterStore, participants, now: () => t };
  return { deps, persistence, counterStore, participants, setNow: (v: number) => (t = v) };
}

const params = (over: Partial<RecoveryParams> = {}): RecoveryParams => ({
  eventId: EVENT,
  hpMax: 1000,
  direction: 'down',
  startedAtTs: 0,
  nextEventInMs: 60_000,
  ...over,
});

describe('canResume policy', () => {
  it('resumes within the max gap and refuses beyond it', () => {
    expect(canResume(AUTO_RECOVERY_MAX_GAP_MS)).toBe(true);
    expect(canResume(AUTO_RECOVERY_MAX_GAP_MS + 1)).toBe(false);
  });
});

describe('recoverEvent', () => {
  it('fresh-starts when nothing was ever checkpointed', async () => {
    const h = harness(1_000_000);
    expect((await recoverEvent(h.deps, params())).action).toBe('fresh-start');
  });

  it('resumes a recent event, restoring the counter and lifecycle status', async () => {
    const h = harness(1_000_000);
    const cp = createCheckpointer({ persistence: h.persistence, eventId: EVENT, now: () => 990_000 });
    await cp.onTick(state({ bossHp: 600, phase: 'phase-2' }), -100);

    const result = await recoverEvent(h.deps, params()); // now is 1_000_000, gap 10s

    expect(result.action).toBe('resumed');
    expect(result.status).toBe('active'); // phase-2 -> active
    expect(result.reconstructedValue).toBe(600);
    expect(await h.counterStore.get(EVENT)).toBe(600);
  });

  it('force-resolves and resets a stale event beyond the gap', async () => {
    const h = harness(10_000_000);
    // Checkpoint long ago (gap >> 5 min).
    const cp = createCheckpointer({ persistence: h.persistence, eventId: EVENT, now: () => 1000 });
    await cp.onTick(state({ bossHp: 600 }), -100);
    // A participant was recorded on the stale event.
    await h.participants.record(EVENT, 'p1', { points: 6000, xp: 100, streak: 1, ts: 500 });

    const result = await recoverEvent(h.deps, params());

    expect(result.action).toBe('force-resolved');
    expect(result.resolvedPlayers).toBe(1);
    // Prior event marked failed, ledger reset, counter re-initialised to full HP.
    expect((await h.persistence.getEvent(EVENT))?.status).toBe('failed');
    expect(await h.participants.list(EVENT)).toEqual([]);
    expect(await h.counterStore.get(EVENT)).toBe(1000);
  });
});
