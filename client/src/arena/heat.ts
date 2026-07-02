/**
 * Personal heat / combo meter (P0-C-6 / OOM-22).
 *
 * A self-only "in the zone" meter: landing good strikes in quick succession builds heat, which raises
 * your *personal* effectiveness multiplier; stop hitting and it cools off. It is the skill-expression
 * reward loop that makes the ten-second contribution feel escalating.
 *
 * Fairness is load-bearing here (indication `enforce-non-p2w-guardrail`, and the task's "never
 * buyable"): heat is driven **only** by hit quality and rhythm — skill — with no input from pass tier
 * or purchases, and it is **self-only** (in P0 it modulates this client's own feedback, never another
 * player's outcome or the global tally). Pure and deterministic (advances only by `dtMs`), so it is
 * fully unit-testable in Node.
 */

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export interface HeatOptions {
  /** Heat added by a perfect (quality 1) hit; scaled by the hit's quality. */
  gainPerHit?: number;
  /** Heat bled off per second of play. */
  decayPerSec?: number;
  /** Heat ceiling — the value that reads as a full (1.0) meter. */
  max?: number;
  /** Effectiveness multiplier at a full meter (1.0 → no boost; e.g. 2.0 → double at max heat). */
  maxMultiplier?: number;
  /** Idle time (ms) with no hit before the combo counter resets. */
  comboWindowMs?: number;
}

export interface Heat {
  /** Register a landed strike; `quality` in [0,1] (e.g. the strike's accuracy). */
  registerHit: (quality: number) => void;
  advance: (dtMs: number) => void;
  /** Normalised heat in [0,1] — drives the meter fill. */
  value: () => number;
  /** Personal effectiveness multiplier in [1, maxMultiplier]. Skill-only, self-only. */
  multiplier: () => number;
  /** Consecutive-hit count within the combo window. */
  combo: () => number;
  reset: () => void;
}

export function createHeat(options: HeatOptions = {}): Heat {
  const gainPerHit = options.gainPerHit ?? 0.18;
  const decayPerSec = options.decayPerSec ?? 0.35;
  const max = options.max ?? 1;
  const maxMultiplier = options.maxMultiplier ?? 2;
  const comboWindowMs = options.comboWindowMs ?? 1600;
  if (max <= 0) throw new Error('max must be > 0');

  let heat = 0;
  let comboCount = 0;
  let idleMs = 0;

  return {
    registerHit(quality) {
      heat = Math.min(max, heat + gainPerHit * clamp01(quality));
      comboCount += 1;
      idleMs = 0;
    },
    advance(dtMs) {
      if (dtMs <= 0) return;
      heat = Math.max(0, heat - (decayPerSec * dtMs) / 1000);
      idleMs += dtMs;
      // No hit for a full window → the streak is broken (heat still cools independently).
      if (idleMs >= comboWindowMs) comboCount = 0;
    },
    value() {
      return heat / max;
    },
    multiplier() {
      // Linear in normalised heat; purely a function of accumulated skill, never of spend.
      return 1 + (maxMultiplier - 1) * (heat / max);
    },
    combo() {
      return comboCount;
    },
    reset() {
      heat = 0;
      comboCount = 0;
      idleMs = 0;
    },
  };
}
