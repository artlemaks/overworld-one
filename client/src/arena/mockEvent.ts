import type { EventState, Phase } from '@overworld/shared';
import { combatPhaseForFraction, combatPhaseProgressPct } from './phases.js';

/**
 * Deterministic mock event driver (P0-C-2 / OOM-18).
 *
 * Until the real server tick stream lands (OOM-32), the arena has nothing authoritative to render.
 * This produces a lifelike sequence of {@link EventState} snapshots — the boss drains through its
 * phases and resolves — so the scene visibly animates. Pure and deterministic (no clock, no random):
 * given the same `dtMs` sequence it always yields the same states, so it is unit-testable in Node.
 */

export interface MockEventOptions {
  /** Boss starting/maximum HP. */
  hpMax: number;
  /** "Get Ready" lead-in before the boss starts taking damage. */
  leadInMs?: number;
  /** HP drained per elapsed ms once combat starts. */
  drainPerMs?: number;
  /** Duration of the "Finishing Blow" beat after HP hits 0, before "Victory". */
  resolveMs?: number;
}

export interface MockEvent {
  readonly hpMax: number;
  /** Current authoritative snapshot. */
  state(): EventState;
  /** Advance the simulation by `dtMs` and return the new snapshot. */
  advance(dtMs: number): EventState;
}

const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

interface Derived {
  phase: Phase;
  phaseProgressPct: number;
}

function derive(
  elapsedMs: number,
  hp: number,
  resolveElapsedMs: number,
  opts: Required<MockEventOptions>,
): Derived {
  if (elapsedMs < opts.leadInMs) {
    const pct = opts.leadInMs > 0 ? (elapsedMs / opts.leadInMs) * 100 : 100;
    return { phase: 'pending', phaseProgressPct: clampPct(pct) };
  }

  const fraction = opts.hpMax > 0 ? hp / opts.hpMax : 0;

  // Combat phase + progress come from the shared threshold logic (OOM-23) so nothing drifts.
  if (fraction > 0) {
    return {
      phase: combatPhaseForFraction(fraction),
      phaseProgressPct: combatPhaseProgressPct(fraction),
    };
  }
  if (resolveElapsedMs < opts.resolveMs) {
    const pct = opts.resolveMs > 0 ? (resolveElapsedMs / opts.resolveMs) * 100 : 100;
    return { phase: 'resolving', phaseProgressPct: clampPct(pct) };
  }
  return { phase: 'resolved', phaseProgressPct: 100 };
}

export function createMockEvent(options: MockEventOptions): MockEvent {
  const opts: Required<MockEventOptions> = {
    leadInMs: 1500,
    drainPerMs: options.hpMax / 20_000, // ~20s of combat from full to 0
    resolveMs: 2000,
    ...options,
  };
  if (opts.hpMax <= 0) throw new Error('hpMax must be > 0');

  let elapsedMs = 0;
  let hp = opts.hpMax;
  let resolveElapsedMs = 0;
  let waves = 0;

  const snapshot = (): EventState => {
    const { phase, phaseProgressPct } = derive(elapsedMs, hp, resolveElapsedMs, opts);
    return {
      bossHp: hp,
      phase,
      phaseProgressPct,
      contribWaveCount: waves,
      // Sampled presence stand-in; never per-player positions (P1-S-7).
      playersContributingNow: phase === 'pending' || phase === 'resolved' ? 0 : 8,
    };
  };

  return {
    hpMax: opts.hpMax,
    state: snapshot,
    advance(dtMs: number): EventState {
      if (dtMs > 0) {
        elapsedMs += dtMs;
        if (elapsedMs > opts.leadInMs) {
          hp = Math.max(0, hp - opts.drainPerMs * dtMs);
          waves += 1;
        }
        if (hp === 0) resolveElapsedMs += dtMs;
      }
      return snapshot();
    },
  };
}
