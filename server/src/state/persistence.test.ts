import { describe, it, expect } from 'vitest';
import {
  createMemoryPersistence,
  type EventRecord,
  type ParticipantResultRow,
} from './persistence.js';
import type { EventSnapshot, ReplayLogEntry, Commemorative } from '@overworld/shared';

const EVENT = 'evt-1';

const eventRecord = (over: Partial<EventRecord> = {}): EventRecord => ({
  eventId: EVENT,
  status: 'active',
  outcome: null,
  hpMax: 1000,
  direction: 'down',
  startedAtTs: 1000,
  resolvedAtTs: null,
  ...over,
});

const snapshot = (seq: number, takenAtTs: number): EventSnapshot => ({
  eventId: EVENT,
  seq,
  state: {
    bossHp: 1000 - seq * 100,
    phase: 'phase-1',
    phaseProgressPct: 0,
    contribWaveCount: 0,
    playersContributingNow: 0,
  },
  takenAtTs,
});

describe('persistence store (memory twin)', () => {
  it('upserts and reads back an event header', async () => {
    const p = createMemoryPersistence();
    await p.upsertEvent(eventRecord());
    expect(await p.getEvent(EVENT)).toMatchObject({ status: 'active', hpMax: 1000 });
    await p.upsertEvent(eventRecord({ status: 'resolved', outcome: 'completed', resolvedAtTs: 5000 }));
    expect(await p.getEvent(EVENT)).toMatchObject({ status: 'resolved', outcome: 'completed', resolvedAtTs: 5000 });
  });

  it('returns null for an unknown event', async () => {
    expect(await createMemoryPersistence().getEvent('nope')).toBeNull();
  });

  it('keeps the highest-seq checkpoint as the latest', async () => {
    const p = createMemoryPersistence();
    await p.writeCheckpoint(snapshot(1, 1000));
    await p.writeCheckpoint(snapshot(3, 3000));
    await p.writeCheckpoint(snapshot(2, 2000));
    expect((await p.latestCheckpoint(EVENT))?.seq).toBe(3);
  });

  it('is idempotent on checkpoint seq', async () => {
    const p = createMemoryPersistence();
    await p.writeCheckpoint(snapshot(1, 1000));
    await p.writeCheckpoint({ ...snapshot(1, 1500) }); // same seq, newer ts
    expect((await p.latestCheckpoint(EVENT))?.takenAtTs).toBe(1500);
  });

  it('returns replay entries strictly after a timestamp, in ts order', async () => {
    const p = createMemoryPersistence();
    const entry = (ts: number, d: number): ReplayLogEntry => ({ eventId: EVENT, ts, contribDelta: d });
    await p.appendReplay(entry(3000, -30));
    await p.appendReplay(entry(1000, -10));
    await p.appendReplay(entry(2000, -20));
    const since = await p.replaySince(EVENT, 1000);
    expect(since.map((e) => e.ts)).toEqual([2000, 3000]);
  });

  it('saves and lists final participant tallies', async () => {
    const p = createMemoryPersistence();
    const row: ParticipantResultRow = {
      eventId: EVENT,
      playerId: 'p1',
      contributionTotal: 500,
      tier: 'gold',
      xpEarned: 250,
      participationDurationMs: 60_000,
      lastUpdateTs: 5000,
    };
    await p.saveParticipants([row]);
    expect(await p.listParticipants(EVENT)).toEqual([row]);
  });

  it('grants and lists commemoratives per player', async () => {
    const p = createMemoryPersistence();
    const c: Commemorative = {
      commemorativeId: 'c1',
      eventId: EVENT,
      rarity: 'epic',
      earnedAtTs: 5000,
      expiresAtTs: 9000,
    };
    await p.grantCommemorative('p1', c);
    expect(await p.listCommemoratives('p1')).toEqual([c]);
    expect(await p.listCommemoratives('other')).toEqual([]);
  });
});
