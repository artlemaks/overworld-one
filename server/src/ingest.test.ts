import { describe, it, expect } from 'vitest';
import type { ContributionMessage } from '@overworld/shared';
import { createMemoryCounterStore } from './state/counters.js';
import { createMemoryPubSub, type ContribEvent } from './state/pubsub.js';
import { createEventEngine } from './game/event.js';
import { createTokenBucketLimiter } from './game/ratelimit.js';
import { createAnomalyDetector } from './game/anticheat.js';
import { createMetrics } from './metrics/registry.js';
import { ingestContribution, type IngestDeps } from './ingest.js';

async function harness() {
  let t = 0;
  const now = (): number => t;
  const store = createMemoryCounterStore();
  const engine = createEventEngine(store, { eventId: 'e', hpMax: 1000, leadInMs: 0 });
  await engine.init();
  const pubsub = createMemoryPubSub();
  const published: ContribEvent[] = [];
  await pubsub.subscribe((e) => published.push(e));
  const metrics = createMetrics({ now });
  const deps: IngestDeps = {
    eventId: 'e',
    engine,
    pubsub,
    limiter: createTokenBucketLimiter({ capacity: 3, refillPerSec: 1, now }),
    detector: createAnomalyDetector({ maxRatePerSec: 100, windowMs: 1000, now }),
    metrics,
    now,
  };
  return { deps, engine, metrics, published, setTime: (v: number) => (t = v) };
}

const contribution = (over: Partial<ContributionMessage> = {}): ContributionMessage => ({
  playerId: 'p1',
  actionType: 'strike',
  inputParams: { aimAccuracy: 1, timingQuality: 1 },
  clientTs: 0,
  ...over,
});

describe('contribution ingest pipeline', () => {
  it('accepts a valid contribution, moves the counter, and publishes it', async () => {
    const { deps, engine, published } = await harness();
    const result = await ingestContribution(deps, contribution(), 'ip:1');
    expect(result.accepted).toBe(true);
    expect(result.points).toBe(100);
    expect((await engine.tick(0, sample())).bossHp).toBe(900);
    expect(published).toHaveLength(1);
    expect(published[0]?.delta).toBe(-100);
  });

  it('rejects value-inflated signals before touching state', async () => {
    const { deps, engine, published } = await harness();
    const result = await ingestContribution(deps, contribution({ inputParams: { aimAccuracy: 9 } }), 'ip:1');
    expect(result.accepted).toBe(false);
    expect(result.reason).toMatch(/out_of_range/);
    expect((await engine.tick(0, sample())).bossHp).toBe(1000); // untouched
    expect(published).toHaveLength(0);
  });

  it('rejects once the rate limit is exhausted', async () => {
    const { deps } = await harness();
    for (let i = 0; i < 3; i++) expect((await ingestContribution(deps, contribution(), 'ip:1')).accepted).toBe(true);
    const blocked = await ingestContribution(deps, contribution(), 'ip:1');
    expect(blocked.accepted).toBe(false);
    expect(blocked.reason).toBe('rate_limited');
  });

  it('records accepted/rejected in metrics', async () => {
    const { deps, metrics } = await harness();
    await ingestContribution(deps, contribution(), 'ip:1');
    await ingestContribution(deps, contribution({ inputParams: { aimAccuracy: 9 } }), 'ip:1');
    const snap = metrics.snapshot();
    expect(snap.contributionsAccepted).toBe(1);
    expect(snap.contributionsRejected).toBe(1);
  });
});

function sample() {
  return { stats: { contribDelta: 0, contribRate: 0 }, playersContributingNow: 0, waveCount: 0 };
}
