import { describe, it, expect } from 'vitest';
import {
  createFloatingText,
  createScreenShake,
  createTween,
  createParticles,
  noopSfx,
} from './juice.js';

/** Grab the first element, failing loudly if empty — keeps strict index access happy in tests. */
function first<T>(arr: T[]): T {
  const [head] = arr;
  if (head === undefined) throw new Error('expected a non-empty array');
  return head;
}

describe('createFloatingText', () => {
  it('spawns an item that starts fully opaque at its spawn point', () => {
    const ft = createFloatingText({ ttlMs: 1000, risePx: 60 });
    ft.spawn('+50', 100, 200, 0x00ff00);
    const item = first(ft.items());
    expect(ft.count()).toBe(1);
    expect(item.text).toBe('+50');
    expect(item.x).toBe(100);
    expect(item.y).toBe(200);
    expect(item.alpha).toBeCloseTo(1);
    expect(item.color).toBe(0x00ff00);
  });

  it('rises and fades over its lifetime', () => {
    const ft = createFloatingText({ ttlMs: 1000, risePx: 60 });
    ft.spawn('+1', 0, 100);
    ft.advance(500); // halfway
    const mid = first(ft.items());
    expect(mid.y).toBeCloseTo(70); // rose 30 of 60px
    expect(mid.alpha).toBeCloseTo(0.75); // 1 - 0.5²
  });

  it('drops items once their ttl elapses', () => {
    const ft = createFloatingText({ ttlMs: 1000 });
    ft.spawn('x', 0, 0);
    ft.advance(1000);
    expect(ft.count()).toBe(0);
    expect(ft.items()).toEqual([]);
  });

  it('clear removes everything', () => {
    const ft = createFloatingText();
    ft.spawn('a', 0, 0);
    ft.spawn('b', 1, 1);
    ft.clear();
    expect(ft.count()).toBe(0);
  });
});

describe('createScreenShake', () => {
  it('is at rest with no trauma', () => {
    const shake = createScreenShake();
    expect(shake.trauma()).toBe(0);
    expect(shake.offset()).toEqual({ x: 0, y: 0, rotation: 0 });
  });

  it('clamps accumulated trauma to 1', () => {
    const shake = createScreenShake();
    shake.add(0.7);
    shake.add(0.7);
    expect(shake.trauma()).toBe(1);
  });

  it('decays trauma toward zero over time', () => {
    const shake = createScreenShake({ decayPerSec: 1 });
    shake.add(1);
    shake.advance(500);
    expect(shake.trauma()).toBeCloseTo(0.5);
    shake.advance(500);
    expect(shake.trauma()).toBeCloseTo(0);
  });

  it('produces a bounded, deterministic offset while shaking', () => {
    const a = createScreenShake({ maxOffsetPx: 20 });
    const b = createScreenShake({ maxOffsetPx: 20 });
    a.add(1);
    b.add(1);
    a.advance(40);
    b.advance(40);
    const oa = a.offset();
    const ob = b.offset();
    expect(oa).toEqual(ob); // deterministic
    expect(Math.abs(oa.x)).toBeLessThanOrEqual(20);
    expect(Math.abs(oa.y)).toBeLessThanOrEqual(20);
  });

  it('scales offset with trauma² (quadratic falloff)', () => {
    const shake = createScreenShake({ maxOffsetPx: 100, decayPerSec: 0, frequency: 0.05 });
    shake.add(0.5);
    shake.advance(40);
    const half = shake.offset();
    // At trauma 0.5, shake = 0.25, so magnitude is a quarter of the max envelope.
    const envelope = 100 * Math.sin(40 * 0.05);
    expect(half.x).toBeCloseTo(0.25 * envelope);
  });
});

describe('createTween', () => {
  it('starts at its initial value', () => {
    expect(createTween(0.5).value()).toBe(0.5);
  });

  it('eases toward a new target without overshooting', () => {
    const tween = createTween(0, { ratePerSec: 6 });
    tween.set(1);
    tween.advance(100);
    const v = tween.value();
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });

  it('converges to the target given enough time', () => {
    const tween = createTween(0, { ratePerSec: 10 });
    tween.set(1);
    for (let i = 0; i < 100; i++) tween.advance(16);
    expect(tween.value()).toBeCloseTo(1, 3);
  });

  it('snap jumps instantly with no residual motion', () => {
    const tween = createTween(0);
    tween.snap(0.8);
    tween.advance(1000);
    expect(tween.value()).toBe(0.8);
  });
});

describe('createParticles', () => {
  it('emits the requested number of particles', () => {
    const p = createParticles();
    p.burst(50, 50, 8);
    expect(p.count()).toBe(8);
  });

  it('moves particles outward and fades them out over ttl', () => {
    const p = createParticles({ ttlMs: 1000 });
    p.burst(0, 0, 4, { speed: 0.1 });
    p.advance(500);
    const items = p.items();
    // Every particle has left the origin and dimmed to ~half.
    for (const it of items) {
      expect(Math.hypot(it.x, it.y)).toBeGreaterThan(0);
      expect(it.alpha).toBeCloseTo(0.5);
    }
  });

  it('removes particles after their ttl', () => {
    const p = createParticles({ ttlMs: 500 });
    p.burst(0, 0, 6);
    p.advance(500);
    expect(p.count()).toBe(0);
  });

  it('is deterministic for the same seed', () => {
    const a = createParticles();
    const b = createParticles();
    a.burst(10, 10, 5, { seed: 1.2 });
    b.burst(10, 10, 5, { seed: 1.2 });
    a.advance(100);
    b.advance(100);
    expect(a.items()).toEqual(b.items());
  });
});

describe('noopSfx', () => {
  it('accepts play calls without throwing', () => {
    expect(() => noopSfx.play('strike', { volume: 0.5 })).not.toThrow();
  });
});
