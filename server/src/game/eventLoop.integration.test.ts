import { describe, it, expect } from 'vitest';
import type { ContributionMessage, EventState } from '@overworld/shared';
import { createMemoryCounterStore } from '../state/counters.js';
import { createMemoryParticipantStore } from '../state/participants.js';
import { createMemoryPersistence } from '../state/persistence.js';
import { createMemoryPubSub } from '../state/pubsub.js';
import { createAggregator } from './aggregation.js';
import { createTokenBucketLimiter } from './ratelimit.js';
import { createAnomalyDetector } from './anticheat.js';
import { createMetrics } from '../metrics/registry.js';
import { createEventEngine } from './event.js';
import { createCheckpointer } from './checkpointer.js';
import { recoverEvent } from './recovery.js';
import { resolveEvent } from './resolution.js';
import { ingestContribution, type IngestDeps } from '../ingest.js';

/**
 * Full event-loop DoD (backlog test a-t3): an event runs phases -> resolution; XP + rewards are
 * granted and **reconciled after a Redis restart within the 60s window**; auto-recovery resumes.
 *
 * Models a Redis restart by throwing away the live counter store and rebuilding it from the durable
 * checkpoint + replay log (Postgres, here the memory twin). Everything else — participants ledger,
 * persistence — is what Postgres keeps across the restart.
 */
describe('P2 event loop end-to-end', () => {
  const EVENT = 'p2-boss';
  const HP_MAX = 1000;

  const contribution = (playerId: string): ContributionMessage => ({
    playerId,
    actionType: 'strike',
    inputParams: { aimAccuracy: 1, timingQuality: 1 }, // flawless -> 100 points
    clientTs: 0,
  });

  it('runs, survives a Redis restart within the window, and resolves with rewards', async () => {
    let t = 1_000_000;
    const now = (): number => t;

    // --- Live infrastructure (Redis in prod) ---
    const counterStore = createMemoryCounterStore();
    const pubsub = createMemoryPubSub();
    const aggregator = createAggregator({ windowMs: 1000, now });
    await pubsub.subscribe((e) => aggregator.record(e));

    // --- Durable infrastructure (Postgres in prod) — survives the restart ---
    const participants = createMemoryParticipantStore();
    const persistence = createMemoryPersistence();

    const engine = createEventEngine(counterStore, {
      eventId: EVENT,
      hpMax: HP_MAX,
      direction: 'down',
      leadInMs: 0,
    });
    await engine.init();
    const checkpointer = createCheckpointer({ persistence, eventId: EVENT, now, intervalMs: 30_000 });

    const ingest: IngestDeps = {
      eventId: EVENT,
      engine,
      pubsub,
      limiter: createTokenBucketLimiter({ capacity: 1000, refillPerSec: 1000, now }),
      detector: createAnomalyDetector({ maxRatePerSec: 10_000, windowMs: 1000, now }),
      metrics: createMetrics({ now }),
      participants,
      now,
    };

    // Drive a tick: fold the aggregate delta into the checkpointer, exactly as the tick loop would.
    const tick = async (deltaThisTick: number): Promise<EventState> => {
      const sample = aggregator.sample();
      const state = await engine.tick(0, sample);
      await checkpointer.onTick(state, deltaThisTick);
      return state;
    };

    // Round 1: two whales pound the boss, then a checkpoint is taken.
    for (let i = 0; i < 3; i++) await ingestContribution(ingest, contribution('whale-a'), 'ip:a');
    for (let i = 0; i < 3; i++) await ingestContribution(ingest, contribution('whale-b'), 'ip:b');
    // 6 * 100 = 600 damage -> hp 400. First tick checkpoints at hp 400.
    await tick(-600);
    expect(await counterStore.get(EVENT)).toBe(400);
    expect((await persistence.latestCheckpoint(EVENT))?.state.bossHp).toBe(400);

    // Round 2 (post-checkpoint, inside the replay window): one more hit, no new checkpoint.
    t += 5_000;
    await ingestContribution(ingest, contribution('whale-a'), 'ip:a'); // -100 -> hp 300
    await tick(-100);
    expect(await counterStore.get(EVENT)).toBe(300);

    // --- Redis restart: the live counter is gone; durable checkpoint + replay remain ---
    t += 2_000; // 7s after the checkpoint — well within the 60s window
    const revivedCounter = createMemoryCounterStore();
    const recovery = await recoverEvent(
      { persistence, counterStore: revivedCounter, participants, now },
      { eventId: EVENT, hpMax: HP_MAX, direction: 'down', startedAtTs: 1_000_000, nextEventInMs: 60_000 },
    );

    expect(recovery.action).toBe('resumed');
    // Reconciled: 400 (checkpoint) + (-100 post-checkpoint) = 300, matching the pre-restart counter.
    expect(recovery.reconstructedValue).toBe(300);
    expect(await revivedCounter.get(EVENT)).toBe(300);

    // --- Resolution: tally, tier, grant XP + commemoratives ---
    const results = await resolveEvent(
      { participants, persistence, now },
      {
        eventId: EVENT,
        outcome: 'completed',
        hpMax: HP_MAX,
        direction: 'down',
        startedAtTs: 1_000_000,
        nextEventInMs: 60_000,
      },
    );

    const whaleA = results.find((r) => r.playerId === 'whale-a')!;
    expect(whaleA.contributionTotal).toBe(400); // 4 hits * 100
    expect(whaleA.tier).toBe('bronze'); // >= 100
    expect(whaleA.xpEarned).toBeGreaterThan(0);
    expect(whaleA.commemorative).not.toBeNull();

    // Durable state reflects the resolution.
    expect((await persistence.getEvent(EVENT))?.status).toBe('resolved');
    expect(await persistence.listParticipants(EVENT)).toHaveLength(2);
    expect(await persistence.listCommemoratives('whale-a')).toHaveLength(1);
  });
});
