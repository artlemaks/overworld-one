import {
  combatPhaseForFraction,
  combatPhaseProgressPct,
  type EventState,
  type Phase,
} from '@overworld/shared';
import type { CounterStore } from '../state/counters.js';
import type { AggregateSample } from './aggregation.js';

/**
 * Authoritative event engine (P1 — ties together OOM-26/29/31).
 *
 * Owns the one server-authoritative truth for an event: its counter (in the {@link CounterStore}) and
 * its lifecycle timing. It maps the raw counter value to the wire {@link EventState} — combat phase
 * and progress come from the **shared** HP→phase math so the client can never disagree about where a
 * boundary is (indication `contracts-single-source-of-truth`).
 *
 * Forward-designed for the P3 reskins (P1-S-2): `direction: 'down'` is a boss draining to 0; a Rising
 * Structure is `direction: 'up'` climbing to `hpMax`. Only the sign of the applied delta and the
 * starting value change — the wire shape and this engine stay identical, so there is no P3 migration.
 */

export type CounterDirection = 'down' | 'up';

export interface EventConfig {
  eventId: string;
  /** Counter magnitude — boss max HP, or a structure's target height. */
  hpMax: number;
  /** 'down' = boss HP drains to 0 (P1); 'up' = structure builds to hpMax (P3). */
  direction?: CounterDirection;
  /** "Get Ready" lead-in before combat, in ms. */
  leadInMs?: number;
  /** "Finishing Blow" beat after the objective completes, before 'resolved'. */
  resolveMs?: number;
}

export interface AppliedContribution {
  /** Signed delta applied to the counter (negative for a boss). */
  delta: number;
  /** The new authoritative counter value after clamping. */
  value: number;
}

export interface EventEngine {
  readonly hpMax: number;
  /** Write the counter's initial value + bounds. Call once before the tick loop starts. */
  init(): Promise<void>;
  /** Apply server-computed `points` as a signed, clamped delta; returns the new counter value. */
  applyContribution(points: number): Promise<AppliedContribution>;
  /** Advance lifecycle timing by `dtMs`, read the counter, and build the authoritative state. */
  tick(dtMs: number, sample: AggregateSample): Promise<EventState>;
}

const DEFAULTS = { direction: 'down' as CounterDirection, leadInMs: 1500, resolveMs: 2000 };

/**
 * Whether the objective is "complete": a boss at 0 HP, or a structure at full height. Completion is
 * what triggers the resolving→resolved beat.
 */
function isComplete(value: number, hpMax: number, direction: CounterDirection): boolean {
  return direction === 'down' ? value <= 0 : value >= hpMax;
}

export function createEventEngine(store: CounterStore, config: EventConfig): EventEngine {
  const cfg = { ...DEFAULTS, ...config };
  if (cfg.hpMax <= 0) throw new Error('hpMax must be > 0');

  let elapsedMs = 0;
  let resolveElapsedMs = 0;

  const clampPct = (n: number): number => Math.min(100, Math.max(0, n));

  const derivePhase = (value: number): { phase: Phase; phaseProgressPct: number } => {
    // 'value' for a boss is HP; the shared math works on the remaining fraction either way.
    const fraction = cfg.hpMax > 0 ? value / cfg.hpMax : 0;
    const combatFraction = cfg.direction === 'down' ? fraction : 1 - fraction;

    if (elapsedMs < cfg.leadInMs) {
      const pct = cfg.leadInMs > 0 ? (elapsedMs / cfg.leadInMs) * 100 : 100;
      return { phase: 'pending', phaseProgressPct: clampPct(pct) };
    }
    if (!isComplete(value, cfg.hpMax, cfg.direction)) {
      return {
        phase: combatPhaseForFraction(combatFraction),
        phaseProgressPct: combatPhaseProgressPct(combatFraction),
      };
    }
    if (resolveElapsedMs < cfg.resolveMs) {
      const pct = cfg.resolveMs > 0 ? (resolveElapsedMs / cfg.resolveMs) * 100 : 100;
      return { phase: 'resolving', phaseProgressPct: clampPct(pct) };
    }
    return { phase: 'resolved', phaseProgressPct: 100 };
  };

  return {
    hpMax: cfg.hpMax,

    async init() {
      await store.init({
        eventId: cfg.eventId,
        initial: cfg.direction === 'down' ? cfg.hpMax : 0,
        floor: 0,
        ceil: cfg.hpMax,
      });
    },

    async applyContribution(points) {
      const delta = cfg.direction === 'down' ? -points : points;
      const value = await store.applyDelta(cfg.eventId, delta);
      return { delta, value };
    },

    async tick(dtMs, sample) {
      if (dtMs > 0) {
        elapsedMs += dtMs;
        const value = await store.get(cfg.eventId);
        if (isComplete(value, cfg.hpMax, cfg.direction) && elapsedMs >= cfg.leadInMs) {
          resolveElapsedMs += dtMs;
        }
      }
      const value = await store.get(cfg.eventId);
      const { phase, phaseProgressPct } = derivePhase(value);
      return {
        bossHp: value,
        phase,
        phaseProgressPct,
        contribWaveCount: sample.waveCount,
        playersContributingNow: sample.playersContributingNow,
      };
    },
  };
}
