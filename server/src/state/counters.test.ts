import { describe, it, expect } from 'vitest';
import { createMemoryCounterStore } from './counters.js';

describe('memory counter store', () => {
  const bossConfig = { eventId: 'e1', initial: 1000, floor: 0, ceil: 1000 };

  it('initialises to the starting value', async () => {
    const store = createMemoryCounterStore();
    await store.init(bossConfig);
    expect(await store.get('e1')).toBe(1000);
  });

  it('applies a negative delta and returns the new value (boss taking damage)', async () => {
    const store = createMemoryCounterStore();
    await store.init(bossConfig);
    expect(await store.applyDelta('e1', -150)).toBe(850);
    expect(await store.applyDelta('e1', -50)).toBe(800);
  });

  it('clamps at the floor — a boss never goes below 0 HP', async () => {
    const store = createMemoryCounterStore();
    await store.init(bossConfig);
    expect(await store.applyDelta('e1', -5000)).toBe(0);
    expect(await store.applyDelta('e1', -10)).toBe(0);
  });

  it('clamps at the ceiling — forward-designed for a Rising Structure (up direction)', async () => {
    const store = createMemoryCounterStore();
    await store.init({ eventId: 'struct', initial: 0, floor: 0, ceil: 500 });
    expect(await store.applyDelta('struct', 300)).toBe(300);
    expect(await store.applyDelta('struct', 900)).toBe(500);
  });

  it('does not lose updates across many sequential deltas', async () => {
    const store = createMemoryCounterStore();
    await store.init(bossConfig);
    for (let i = 0; i < 100; i++) await store.applyDelta('e1', -1);
    expect(await store.get('e1')).toBe(900);
  });

  it('throws when applying a delta before init', async () => {
    const store = createMemoryCounterStore();
    await expect(store.applyDelta('missing', -1)).rejects.toThrow(/not initialised/);
  });
});
