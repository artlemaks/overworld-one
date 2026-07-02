import { describe, it, expect } from 'vitest';
import {
  createMemoryParticipantStore,
  type ParticipantDelta,
  type ParticipantStore,
} from './participants.js';

const delta = (over: Partial<ParticipantDelta> = {}): ParticipantDelta => ({
  points: 100,
  xp: 50,
  streak: 1,
  ts: 1000,
  ...over,
});

const EVENT = 'evt-1';

describe('participant store (memory twin)', () => {
  const store: ParticipantStore = createMemoryParticipantStore();

  it('creates a record on the first contribution', async () => {
    const rec = await store.record(EVENT, 'p1', delta());
    expect(rec).toMatchObject({
      playerId: 'p1',
      contributionTotal: 100,
      contributionCount: 1,
      xpEarned: 50,
      comboStreak: 1,
      firstTs: 1000,
      lastTs: 1000,
    });
  });

  it('accumulates totals and advances lastTs / streak', async () => {
    await store.record(EVENT, 'p1', delta({ points: 40, xp: 20, streak: 2, ts: 1500 }));
    const rec = await store.get(EVENT, 'p1');
    expect(rec).toMatchObject({
      contributionTotal: 140,
      contributionCount: 2,
      xpEarned: 70,
      comboStreak: 2,
      firstTs: 1000,
      lastTs: 1500,
    });
  });

  it('returns null for a player who never contributed', async () => {
    expect(await store.get(EVENT, 'ghost')).toBeNull();
  });

  it('lists every participant for tallying at resolution', async () => {
    await store.record(EVENT, 'p2', delta({ points: 999, ts: 2000 }));
    const all = await store.list(EVENT);
    expect(all.map((r) => r.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('isolates events from one another', async () => {
    await store.record('evt-2', 'p1', delta({ points: 5 }));
    expect((await store.get('evt-2', 'p1'))?.contributionTotal).toBe(5);
    expect((await store.get(EVENT, 'p1'))?.contributionTotal).toBe(140);
  });

  it('reset drops all per-player state for an event', async () => {
    await store.reset(EVENT);
    expect(await store.list(EVENT)).toEqual([]);
    expect(await store.get(EVENT, 'p1')).toBeNull();
  });
});
