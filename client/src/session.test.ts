import { describe, it, expect } from 'vitest';
import { getOrCreateSession, type KVStorage } from './session.js';

function memStorage(seed: Record<string, string> = {}): KVStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('getOrCreateSession', () => {
  it('creates and persists a new session when storage is empty', () => {
    const store = memStorage();
    let n = 0;
    const s = getOrCreateSession(
      store,
      () => `id-${n++}`,
      () => 1000,
    );
    expect(s).toEqual({ playerId: 'id-0', createdAt: 1000 });
    expect(store.getItem('ow.session')).toBe(JSON.stringify(s));
  });

  it('reuses the stored session on a second call (stable playerId)', () => {
    const store = memStorage();
    const first = getOrCreateSession(store, () => 'stable');
    const second = getOrCreateSession(store, () => 'different');
    expect(second.playerId).toBe(first.playerId);
    expect(second.playerId).toBe('stable');
  });

  it('regenerates when the stored value is corrupt JSON', () => {
    const store = memStorage({ 'ow.session': '{not json' });
    const s = getOrCreateSession(store, () => 'fresh');
    expect(s.playerId).toBe('fresh');
    expect(store.getItem('ow.session')).toBe(JSON.stringify(s));
  });

  it('regenerates when the stored object is missing required fields', () => {
    const store = memStorage({ 'ow.session': JSON.stringify({ playerId: '' }) });
    const s = getOrCreateSession(store, () => 'fresh');
    expect(s.playerId).toBe('fresh');
  });
});
