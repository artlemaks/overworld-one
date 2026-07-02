/**
 * Feedback juice (P0-C-5 / OOM-21).
 *
 * The "visible impact" half of the ten-second-contribution feel: when a strike lands the screen
 * should *react* — a number pops off the boss, the camera kicks, sparks fly, the HP bar slides. This
 * module holds the pure, deterministic state for those effects (floating text, trauma-based screen
 * shake, a numeric tween, particle bursts) plus an injectable {@link SfxSink} so audio can hook in
 * later without this module knowing about the browser.
 *
 * Everything here is clock-free and RNG-free: state advances only by the `dtMs` the fixed loop feeds
 * it, and "randomness" (shake wobble, particle spread) is derived deterministically from an internal
 * clock / the particle index. So it is fully unit-testable in Node and identical across runs — the
 * scene stays the thin renderer (indication `client-screens-pure-and-testable`).
 */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Sound sink — injected so audio wiring (deferred in P0) never couples into the sim. */
export interface SfxSink {
  play(name: string, opts?: { volume?: number }): void;
}

/** Default no-op sink: the P0 prototype ships no audio pipeline yet. */
export const noopSfx: SfxSink = { play() {} };

// ---------------------------------------------------------------------------
// Floating text — number pops that rise and fade.
// ---------------------------------------------------------------------------

export interface FloatingItem {
  text: string;
  /** Current position (starts at the spawn point, rises over its lifetime). */
  x: number;
  y: number;
  /** Opacity in [0,1], eased to 0 at end of life. */
  alpha: number;
  /** Scale multiplier — a brief pop then settle. */
  scale: number;
  color: number;
}

export interface FloatingText {
  /** Spawn a pop at `(x, y)`. */
  spawn: (text: string, x: number, y: number, color?: number) => void;
  advance: (dtMs: number) => void;
  /** Live items with their eased alpha/scale/position for this frame. */
  items: () => FloatingItem[];
  count: () => number;
  clear: () => void;
}

interface FloatingEntry {
  text: string;
  x: number;
  y: number;
  color: number;
  ageMs: number;
}

export function createFloatingText(opts: { ttlMs?: number; risePx?: number } = {}): FloatingText {
  const ttlMs = opts.ttlMs ?? 900;
  const risePx = opts.risePx ?? 60;
  let entries: FloatingEntry[] = [];

  return {
    spawn(text, x, y, color = 0xffffff) {
      entries.push({ text, x, y, color, ageMs: 0 });
    },
    advance(dtMs) {
      if (dtMs > 0) for (const e of entries) e.ageMs += dtMs;
      entries = entries.filter((e) => e.ageMs < ttlMs);
    },
    items() {
      return entries.map((e) => {
        const t = clamp01(e.ageMs / ttlMs);
        return {
          text: e.text,
          x: e.x,
          y: e.y - risePx * t,
          alpha: 1 - t * t, // ease-out fade
          scale: 1 + 0.4 * (1 - t), // pop big, settle to 1
          color: e.color,
        };
      });
    },
    count() {
      return entries.length;
    },
    clear() {
      entries = [];
    },
  };
}

// ---------------------------------------------------------------------------
// Screen shake — Nordvig "trauma" model: trauma decays, shake = trauma².
// ---------------------------------------------------------------------------

export interface ShakeOffset {
  x: number;
  y: number;
  rotation: number;
}

export interface ScreenShake {
  /** Add trauma (clamped so a burst of hits can't exceed max shake). */
  add: (amount: number) => void;
  advance: (dtMs: number) => void;
  /** Deterministic offset for the current instant; zero when trauma is spent. */
  offset: () => ShakeOffset;
  trauma: () => number;
}

export function createScreenShake(
  opts: {
    maxOffsetPx?: number;
    maxRotationRad?: number;
    decayPerSec?: number;
    frequency?: number;
  } = {},
): ScreenShake {
  const maxOffsetPx = opts.maxOffsetPx ?? 18;
  const maxRotationRad = opts.maxRotationRad ?? 0.05;
  const decayPerSec = opts.decayPerSec ?? 1.4;
  const frequency = opts.frequency ?? 0.05; // rad per ms

  let trauma = 0;
  let clockMs = 0;

  return {
    add(amount) {
      trauma = clamp01(trauma + amount);
    },
    advance(dtMs) {
      if (dtMs <= 0) return;
      clockMs += dtMs;
      trauma = Math.max(0, trauma - (decayPerSec * dtMs) / 1000);
    },
    offset() {
      const shake = trauma * trauma;
      // Distinct phase offsets per channel so the axes don't move in lockstep.
      return {
        x: maxOffsetPx * shake * Math.sin(clockMs * frequency),
        y: maxOffsetPx * shake * Math.sin(clockMs * frequency * 1.3 + 1.7),
        rotation: maxRotationRad * shake * Math.sin(clockMs * frequency * 0.9 + 3.1),
      };
    },
    trauma() {
      return trauma;
    },
  };
}

// ---------------------------------------------------------------------------
// Tween — frame-rate-independent exponential smoothing toward a target.
// ---------------------------------------------------------------------------

export interface Tween {
  /** Aim the tween at a new target; it eases there over time. */
  set: (target: number) => void;
  /** Jump instantly to a value (both current and target) — e.g. on reset. */
  snap: (value: number) => void;
  advance: (dtMs: number) => void;
  value: () => number;
}

export function createTween(initial: number, opts: { ratePerSec?: number } = {}): Tween {
  const ratePerSec = opts.ratePerSec ?? 6;
  let current = initial;
  let target = initial;

  return {
    set(next) {
      target = next;
    },
    snap(value) {
      current = value;
      target = value;
    },
    advance(dtMs) {
      if (dtMs <= 0) return;
      // 1 - e^(-rate·t): exponential approach, independent of step size.
      const k = 1 - Math.exp((-ratePerSec * dtMs) / 1000);
      current += (target - current) * k;
    },
    value() {
      return current;
    },
  };
}

// ---------------------------------------------------------------------------
// Particles — a radial burst that fans out and fades. Deterministic by index.
// ---------------------------------------------------------------------------

export interface ParticleItem {
  x: number;
  y: number;
  alpha: number;
  radius: number;
  color: number;
}

export interface Particles {
  /** Emit `count` particles fanning out from `(x, y)`; `seed` rotates the fan. */
  burst: (x: number, y: number, count: number, opts?: { seed?: number; speed?: number; color?: number }) => void;
  advance: (dtMs: number) => void;
  items: () => ParticleItem[];
  count: () => number;
  clear: () => void;
}

interface ParticleEntry {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: number;
  ageMs: number;
}

export function createParticles(opts: { ttlMs?: number; radiusPx?: number } = {}): Particles {
  const ttlMs = opts.ttlMs ?? 600;
  const radiusPx = opts.radiusPx ?? 4;
  let entries: ParticleEntry[] = [];

  return {
    burst(x, y, count, o = {}) {
      const speed = o.speed ?? 0.15; // px per ms
      const seed = o.seed ?? 0;
      const color = o.color ?? 0xffd166;
      const n = Math.max(0, Math.floor(count));
      for (let i = 0; i < n; i++) {
        // Even angular spread + a seed rotation → deterministic, no RNG.
        const angle = (i / Math.max(1, n)) * Math.PI * 2 + seed;
        entries.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          color,
          ageMs: 0,
        });
      }
    },
    advance(dtMs) {
      if (dtMs > 0) {
        for (const p of entries) {
          p.x += p.vx * dtMs;
          p.y += p.vy * dtMs;
          p.ageMs += dtMs;
        }
      }
      entries = entries.filter((p) => p.ageMs < ttlMs);
    },
    items() {
      return entries.map((p) => {
        const t = clamp01(p.ageMs / ttlMs);
        return { x: p.x, y: p.y, alpha: 1 - t, radius: radiusPx * (1 - 0.5 * t), color: p.color };
      });
    },
    count() {
      return entries.length;
    },
    clear() {
      entries = [];
    },
  };
}
