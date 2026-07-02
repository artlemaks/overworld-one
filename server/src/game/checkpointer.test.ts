import { describe, it, expect } from 'vitest';
import { createCheckpointer, reconstructFromCheckpoint } from './checkpointer.js';
import { createMemoryPersistence } from '../state/persistence.js';
import type { EventState } from '@overworld/shared';

const EVENT = 'evt-1';

const state = (over: Partial<EventState> = {}): EventState => ({
  bossHp: 1000,
  phase: 'phase-1',
  phaseProgressPct: 0,
  contribWaveCount: 0,
  playersContributingNow: 0,
  ...over,
});

const clock = (start: number): { now: () => number; set: (v: number) => void } => {
  let t = start;
  return { now: () => t, set: (v) => (t = v) };
};

describe('checkpointer', () => {
  it('checkpoints on the very first tick and appends a replay entry', async () => {
    const persistence = createMemoryPersistence();
    const c = clock(1000);
    const cp = createCheckpointer({ persistence, eventId: EVENT, now: c.now });
    const r = await cp.onTick(state({ bossHp: 900 }), -100);
    expect(r.checkpointed).toBe(true);
    expect((await persistence.latestCheckpoint(EVENT))?.state.bossHp).toBe(900);
  });

  it('does not re-checkpoint within the interval', async () => {
    const persistence = createMemoryPersistence();
    const c = clock(1000);
    const cp = createCheckpointer({ persistence, eventId: EVENT, now: c.now, intervalMs: 30_000 });
    await cp.onTick(state(), -10);
    c.set(1000 + 5000); // 5s later, same phase
    const r = await cp.onTick(state(), -10);
    expect(r.checkpointed).toBe(false);
    expect(cp.seq()).toBe(1);
  });

  it('checkpoints again once the interval elapses', async () => {
    const persistence = createMemoryPersistence();
    const c = clock(1000);
    const cp = createCheckpointer({ persistence, eventId: EVENT, now: c.now, intervalMs: 30_000 });
    await cp.onTick(state(), -10);
    c.set(1000 + 30_000);
    const r = await cp.onTick(state(), -10);
    expect(r.checkpointed).toBe(true);
    expect(cp.seq()).toBe(2);
  });

  it('forces a checkpoint on a phase change even mid-interval', async () => {
    const persistence = createMemoryPersistence();
    const c = clock(1000);
    const cp = createCheckpointer({ persistence, eventId: EVENT, now: c.now, intervalMs: 30_000 });
    await cp.onTick(state({ phase: 'phase-1' }), -10);
    c.set(1000 + 2000); // only 2s later...
    const r = await cp.onTick(state({ phase: 'phase-2' }), -10); // ...but the phase changed
    expect(r.checkpointed).toBe(true);
    expect((await persistence.latestCheckpoint(EVENT))?.state.phase).toBe('phase-2');
  });
});

describe('reconstructFromCheckpoint', () => {
  it('returns null when nothing was ever checkpointed', async () => {
    const persistence = createMemoryPersistence();
    expect(await reconstructFromCheckpoint(persistence, EVENT, 1000)).toBeNull();
  });

  it('re-applies replay deltas recorded after the checkpoint', async () => {
    const persistence = createMemoryPersistence();
    const c = clock(1000);
    const cp = createCheckpointer({ persistence, eventId: EVENT, now: c.now, intervalMs: 30_000 });
    // Checkpoint at hp 900...
    await cp.onTick(state({ bossHp: 900 }), -100);
    // ...then two post-checkpoint ticks drain another 120.
    c.set(2000);
    await cp.onTick(state({ bossHp: 830 }), -70);
    c.set(3000);
    await cp.onTick(state({ bossHp: 780 }), -50);

    const recon = await reconstructFromCheckpoint(persistence, EVENT, 1000);
    // 900 (snapshot) + (-70) + (-50) from the replay window after the snapshot ts.
    expect(recon?.reconstructedValue).toBe(780);
    expect(recon?.appliedEntries).toBe(2);
  });

  it('clamps the reconstructed value to [0, hpMax]', async () => {
    const persistence = createMemoryPersistence();
    const c = clock(1000);
    const cp = createCheckpointer({ persistence, eventId: EVENT, now: c.now, intervalMs: 30_000 });
    await cp.onTick(state({ bossHp: 100 }), -10);
    c.set(2000);
    await cp.onTick(state({ bossHp: 0 }), -5000); // massive overkill delta
    const recon = await reconstructFromCheckpoint(persistence, EVENT, 1000);
    expect(recon?.reconstructedValue).toBe(0);
  });
});
