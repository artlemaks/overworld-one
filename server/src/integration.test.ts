import { describe, it, expect } from 'vitest';
import type { ContributionMessage } from '@overworld/shared';
import { createMemoryCounterStore } from './state/counters.js';
import { createMemoryParticipantStore } from './state/participants.js';
import { createMemoryPubSub } from './state/pubsub.js';
import { createEventEngine } from './game/event.js';
import { createAggregator } from './game/aggregation.js';
import { createTokenBucketLimiter } from './game/ratelimit.js';
import { createAnomalyDetector } from './game/anticheat.js';
import { createMetrics } from './metrics/registry.js';
import { ingestContribution } from './ingest.js';

/**
 * Cross-node integrity (test a-t2): ingest→Redis-atomic→tick delta across nodes, no lost/doubled
 * contributions. Modelled with a SHARED counter store + SHARED pub/sub (what Redis provides in prod)
 * and two independent node graphs. A contribution ingested on node A must (a) move the shared counter
 * exactly once and (b) appear in node B's aggregation window via pub/sub.
 */
describe('two-node contribution integrity', () => {
  it('applies each contribution to the shared counter exactly once and fans out to both aggregators', async () => {
    const t = 0;
    const now = (): number => t;
    const store = createMemoryCounterStore(); // shared authoritative counter (Redis in prod)
    const pubsub = createMemoryPubSub(); // shared fan-out (Redis pub/sub in prod)

    const engine = createEventEngine(store, { eventId: 'e', hpMax: 1000, leadInMs: 0 });
    await engine.init();

    // Two nodes, each with its own aggregator, both subscribed to the shared bus.
    const aggA = createAggregator({ windowMs: 1000, now });
    const aggB = createAggregator({ windowMs: 1000, now });
    await pubsub.subscribe((e) => aggA.record(e));
    await pubsub.subscribe((e) => aggB.record(e));

    const deps = {
      eventId: 'e',
      engine,
      pubsub,
      limiter: createTokenBucketLimiter({ capacity: 1000, refillPerSec: 1000, now }),
      detector: createAnomalyDetector({ maxRatePerSec: 10_000, windowMs: 1000, now }),
      metrics: createMetrics({ now }),
      participants: createMemoryParticipantStore(),
      now,
    };

    const contribution = (playerId: string): ContributionMessage => ({
      playerId,
      actionType: 'strike',
      inputParams: { aimAccuracy: 1, timingQuality: 1 },
      clientTs: 0,
    });

    // 10 distinct players each contribute once (all ingested on "node A").
    for (let i = 0; i < 10; i++) await ingestContribution(deps, contribution(`p${i}`), `ip:${i}`);

    // Counter moved by exactly 10 * 100 = 1000 -> boss at 0, not doubled, not lost.
    const state = await engine.tick(0, sample());
    expect(state.bossHp).toBe(0);

    // Both nodes' aggregators saw all 10 distinct players (fan-out, no loss).
    expect(aggA.sample().playersContributingNow).toBe(10);
    expect(aggB.sample().playersContributingNow).toBe(10);
  });
});

function sample() {
  return { stats: { contribDelta: 0, contribRate: 0 }, playersContributingNow: 0, waveCount: 0 };
}
