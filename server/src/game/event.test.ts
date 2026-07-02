import { describe, it, expect } from 'vitest';
import { createMemoryCounterStore } from '../state/counters.js';
import { createEventEngine } from './event.js';

const emptySample = {
  stats: { contribDelta: 0, contribRate: 0 },
  playersContributingNow: 0,
  waveCount: 0,
};

async function bossEngine(hpMax = 900) {
  const store = createMemoryCounterStore();
  const engine = createEventEngine(store, { eventId: 'e', hpMax, leadInMs: 1000, resolveMs: 1000 });
  await engine.init();
  return engine;
}

describe('event engine (boss, down direction)', () => {
  it('initialises the counter to full HP', async () => {
    const engine = await bossEngine(900);
    const state = await engine.tick(0, emptySample);
    expect(state.bossHp).toBe(900);
  });

  it('applies contributions as negative deltas, clamped at 0', async () => {
    const engine = await bossEngine(900);
    expect((await engine.applyContribution(100)).value).toBe(800);
    expect((await engine.applyContribution(10_000)).value).toBe(0);
  });

  it('reports the pending lead-in before combat', async () => {
    const engine = await bossEngine(900);
    const state = await engine.tick(500, emptySample); // < 1000ms lead-in
    expect(state.phase).toBe('pending');
  });

  it('moves through combat phases as HP drains (shared thresholds)', async () => {
    const engine = await bossEngine(900);
    await engine.tick(1000, emptySample); // finish lead-in
    expect((await engine.tick(1, emptySample)).phase).toBe('phase-1');

    await engine.applyContribution(400); // 500/900 -> just above 1/3, phase-2
    expect((await engine.tick(1, emptySample)).phase).toBe('phase-2');

    await engine.applyContribution(400); // 100/900 -> below 1/3, phase-3
    expect((await engine.tick(1, emptySample)).phase).toBe('phase-3');
  });

  it('transitions to resolving then resolved after the kill', async () => {
    const engine = await bossEngine(900);
    await engine.tick(1000, emptySample); // finish lead-in
    await engine.applyContribution(900); // dead
    expect((await engine.tick(1, emptySample)).phase).toBe('resolving');
    const resolved = await engine.tick(2000, emptySample); // past resolveMs
    expect(resolved.phase).toBe('resolved');
  });

  it('folds the aggregate sample into the wire state', async () => {
    const engine = await bossEngine(900);
    const state = await engine.tick(1, {
      stats: { contribDelta: -20, contribRate: 4 },
      playersContributingNow: 7,
      waveCount: 3,
    });
    expect(state.contribWaveCount).toBe(3);
    expect(state.playersContributingNow).toBe(7);
  });
});

describe('event engine (structure, up direction — P3 forward design)', () => {
  it('builds up toward hpMax with positive deltas and completes at the ceiling', async () => {
    const store = createMemoryCounterStore();
    const engine = createEventEngine(store, {
      eventId: 's',
      hpMax: 500,
      direction: 'up',
      leadInMs: 0,
      resolveMs: 0,
    });
    await engine.init();
    expect((await engine.applyContribution(200)).value).toBe(200);
    expect((await engine.applyContribution(1000)).value).toBe(500); // clamped at ceil
    const state = await engine.tick(1, emptySample);
    expect(state.phase).toBe('resolved');
  });
});
