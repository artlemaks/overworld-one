// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { startApp } from './app.js';
import type { KVStorage } from './session.js';

function memStorage(): KVStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe('startApp (landing -> arena flow)', () => {
  let root: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
  });

  it('renders the landing screen with a Join button', () => {
    const app = startApp(root, { storage: memStorage() });
    expect(app.screen).toBe('landing');
    const btn = root.querySelector('[data-testid="join"]');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe('Join the fight');
  });

  it('joins the arena on click: mounts canvas, issues a token, records a duration', () => {
    let t = 0;
    const app = startApp(root, { storage: memStorage(), now: () => (t += 5) });
    (root.querySelector('[data-testid="join"]') as HTMLButtonElement).click();

    expect(app.screen).toBe('arena');
    expect(root.querySelector('#arena-canvas')).not.toBeNull();
    expect(app.session?.playerId).toBeTruthy();
    // now() ticks +5 twice around the join → 5ms measured.
    expect(app.joinDurationMs).toBe(5);
  });

  it('a returning player keeps the same playerId', () => {
    const storage = memStorage();
    const first = startApp(root, { storage });
    (root.querySelector('[data-testid="join"]') as HTMLButtonElement).click();
    const id1 = first.session?.playerId;

    const second = startApp(root, { storage });
    (root.querySelector('[data-testid="join"]') as HTMLButtonElement).click();
    expect(second.session?.playerId).toBe(id1);
  });
});
