import { describe, it, expect } from 'vitest';
import { resolveEvent, computeTier, type ResolutionDeps } from './resolution.js';
import { createMemoryParticipantStore } from '../state/participants.js';
import { createMemoryPersistence } from '../state/persistence.js';

const EVENT = 'evt-1';

async function harness() {
  const participants = createMemoryParticipantStore();
  const persistence = createMemoryPersistence();
  let t = 5_000_000;
  const deps: ResolutionDeps = { participants, persistence, now: () => t };
  return { deps, participants, persistence, setNow: (v: number) => (t = v) };
}

const baseParams = {
  eventId: EVENT,
  outcome: 'completed' as const,
  hpMax: 1000,
  direction: 'down' as const,
  startedAtTs: 0,
  nextEventInMs: 60_000,
};

describe('computeTier', () => {
  it('returns none below the bronze threshold', () => {
    expect(computeTier(50)).toBe('none');
  });
  it('climbs tiers with contribution', () => {
    expect(computeTier(100)).toBe('bronze');
    expect(computeTier(1000)).toBe('silver');
    expect(computeTier(5000)).toBe('gold');
    expect(computeTier(20_000)).toBe('legendary');
  });
});

describe('resolveEvent', () => {
  it('tallies tiers, grants XP + commemoratives, and returns per-player payloads', async () => {
    const { deps, participants, persistence } = await harness();
    await participants.record(EVENT, 'whale', { points: 6000, xp: 400, streak: 5, ts: 1000 });
    await participants.record(EVENT, 'casual', { points: 150, xp: 30, streak: 1, ts: 2000 });

    const results = await resolveEvent(deps, baseParams);

    const whale = results.find((r) => r.playerId === 'whale')!;
    expect(whale.tier).toBe('gold');
    expect(whale.xpEarned).toBe(400);
    expect(whale.commemorative?.rarity).toBe('epic');
    expect(whale.nextEventInMs).toBe(60_000);

    const casual = results.find((r) => r.playerId === 'casual')!;
    expect(casual.tier).toBe('bronze');
    expect(casual.commemorative?.rarity).toBe('common');

    // Durable rows + commemorative grants persisted.
    expect(await persistence.listParticipants(EVENT)).toHaveLength(2);
    expect(await persistence.listCommemoratives('whale')).toHaveLength(1);
    expect((await persistence.getEvent(EVENT))?.status).toBe('resolved');
  });

  it('marks the event failed and downgrades commemoratives on a failed outcome', async () => {
    const { deps, participants, persistence } = await harness();
    await participants.record(EVENT, 'p1', { points: 6000, xp: 100, streak: 1, ts: 1000 });

    const results = await resolveEvent(deps, { ...baseParams, outcome: 'failed' });

    expect(results[0]?.outcome).toBe('failed');
    expect(results[0]?.tier).toBe('gold'); // tier is contribution-based, unchanged
    expect(results[0]?.commemorative?.rarity).toBe('rare'); // epic downgraded on failure
    expect((await persistence.getEvent(EVENT))?.status).toBe('failed');
  });

  it('is idempotent — re-resolving grants the same commemorative id, not a duplicate', async () => {
    const { deps, participants, persistence } = await harness();
    await participants.record(EVENT, 'p1', { points: 6000, xp: 100, streak: 1, ts: 1000 });

    await resolveEvent(deps, baseParams);
    await resolveEvent(deps, baseParams);

    // Memory twin appends; production upserts on the deterministic id. Assert the id is stable so the
    // pg ON CONFLICT DO NOTHING keeps it single.
    const badges = await persistence.listCommemoratives('p1');
    expect(new Set(badges.map((b) => b.commemorativeId)).size).toBe(1);
  });

  it('resolves an empty event to no payloads', async () => {
    const { deps, persistence } = await harness();
    expect(await resolveEvent(deps, baseParams)).toEqual([]);
    expect((await persistence.getEvent(EVENT))?.status).toBe('resolved');
  });
});
