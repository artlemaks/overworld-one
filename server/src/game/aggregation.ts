import type { AggregateStats } from '@overworld/shared';
import type { ContribEvent } from '../state/pubsub.js';

/**
 * Contribution-wave aggregation + aggregate presence (P1-S-5 & P1-S-7 / OOM-29, OOM-31).
 *
 * This is the heart of the **constant-per-client-bandwidth** guarantee. However many thousands of
 * players contribute, each node samples their recent activity down to a handful of numbers that ride
 * in every fixed-size tick — the tick never grows with player count because it carries *aggregates,
 * never per-player rows*.
 *
 * Every accepted contribution (from this node or, via pub/sub, any other) is `record`ed. Each tick the
 * loop calls `sample`, which yields:
 *  - **per-tick** (since the previous sample): `contribDelta` (summed counter movement) and
 *    `waveCount` (how many contributions landed this window) — the "wave" the client animates;
 *  - **rolling** (over `windowMs`): `contribRate` (contributions/sec) and `playersContributingNow`
 *    (distinct players seen in the window) — sampled presence, never positions.
 *
 * Pure aside from the injected clock, so it is fully unit-testable in Node.
 */

export interface AggregatorOptions {
  /** Rolling window for presence + rate sampling. */
  windowMs: number;
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
}

/** The sampled numbers a tick needs, split into the shared {@link AggregateStats} plus presence. */
export interface AggregateSample {
  stats: AggregateStats;
  /** Distinct players seen in the rolling window (P1-S-7 aggregate presence). */
  playersContributingNow: number;
  /** Contributions recorded since the previous sample — the current "wave". */
  waveCount: number;
}

export interface Aggregator {
  /** Fold one accepted contribution into the window. */
  record(event: Pick<ContribEvent, 'playerId' | 'delta' | 'ts'>): void;
  /** Snapshot the aggregates for a tick and reset the per-tick accumulators. */
  sample(): AggregateSample;
}

interface Entry {
  ts: number;
  playerId: string;
}

export function createAggregator(opts: AggregatorOptions): Aggregator {
  const { windowMs } = opts;
  const now = opts.now ?? (() => Date.now());
  if (windowMs <= 0) throw new Error('windowMs must be > 0');

  const window: Entry[] = [];
  let sinceTickDelta = 0;
  let sinceTickCount = 0;

  const prune = (ts: number): void => {
    const cutoff = ts - windowMs;
    while (window.length > 0) {
      const head = window[0];
      if (head === undefined || head.ts > cutoff) break;
      window.shift();
    }
  };

  return {
    record(event) {
      window.push({ ts: event.ts, playerId: event.playerId });
      sinceTickDelta += event.delta;
      sinceTickCount += 1;
    },
    sample() {
      const ts = now();
      prune(ts);

      const distinct = new Set<string>();
      for (const e of window) distinct.add(e.playerId);

      const contribRate = window.length / (windowMs / 1000);
      const sample: AggregateSample = {
        stats: {
          contribDelta: sinceTickDelta,
          contribRate,
        },
        playersContributingNow: distinct.size,
        waveCount: sinceTickCount,
      };

      sinceTickDelta = 0;
      sinceTickCount = 0;
      return sample;
    },
  };
}
