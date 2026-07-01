import { describe, it, expect } from 'vitest';
import {
  EventSnapshot,
  ReplayLogEntry,
  CHECKPOINT_INTERVAL_MS,
  REPLAY_WINDOW_MS,
  AUTO_RECOVERY_MAX_GAP_MS,
} from './checkpoint.js';

describe('checkpoint cadence constants', () => {
  it('checkpoints at least as often as the replay window (bounds data loss)', () => {
    expect(CHECKPOINT_INTERVAL_MS).toBeLessThanOrEqual(REPLAY_WINDOW_MS);
  });

  it('auto-recovery gap is larger than one checkpoint interval', () => {
    expect(AUTO_RECOVERY_MAX_GAP_MS).toBeGreaterThan(CHECKPOINT_INTERVAL_MS);
  });
});

describe('EventSnapshot', () => {
  it('round-trips a valid snapshot embedding event state', () => {
    const snap = {
      eventId: 'evt-1',
      seq: 3,
      state: {
        bossHp: 100,
        phase: 'phase-3' as const,
        phaseProgressPct: 88,
        contribWaveCount: 2,
        playersContributingNow: 40,
      },
      takenAtTs: 5000,
    };
    expect(EventSnapshot.parse(snap)).toEqual(snap);
  });

  it('rejects a snapshot with a negative sequence', () => {
    const result = EventSnapshot.safeParse({
      eventId: 'evt-1',
      seq: -1,
      state: {
        bossHp: 100,
        phase: 'phase-1',
        phaseProgressPct: 0,
        contribWaveCount: 0,
        playersContributingNow: 0,
      },
      takenAtTs: 5000,
    });
    expect(result.success).toBe(false);
  });
});

describe('ReplayLogEntry', () => {
  it('accepts a negative contribDelta (corrections are allowed)', () => {
    const entry = { eventId: 'evt-1', ts: 1234, contribDelta: -10 };
    expect(ReplayLogEntry.parse(entry)).toEqual(entry);
  });
});
