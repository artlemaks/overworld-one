import { encode, type TickSnapshot } from '@overworld/shared';
import type { EventEngine } from './event.js';
import type { Aggregator } from './aggregation.js';
import type { Metrics } from '../metrics/registry.js';

/**
 * Tick broadcast loop (P1-S-5 / OOM-29).
 *
 * Every 1/`tickHz` seconds it: samples the aggregator, folds that into the authoritative
 * {@link EventState} via the engine, and broadcasts **one identical, fixed-size frame to every
 * client**. That single-encode-fan-out is exactly why per-client bandwidth stays constant regardless
 * of player count (the P1 DoD) — the payload carries aggregates, and every socket gets the same bytes.
 *
 * `runOnce` is separated from `start`/`stop` so the whole thing is unit-testable without real timers:
 * a test drives ticks by hand and asserts the emitted snapshot; production just wires `runOnce` to an
 * interval.
 */

export interface TickLoopDeps {
  engine: EventEngine;
  aggregator: Aggregator;
  metrics: Metrics;
  /** Server tick rate (Hz). P1 DoD requires ≥ 3. */
  tickHz: number;
  /** Injectable clock (epoch ms). */
  now: () => number;
  /**
   * Send the already-encoded tick frame to every connected client and return how many were sent.
   * Encoding once here (not per client) is what keeps the fan-out cheap and the bytes identical.
   */
  broadcast: (frame: string) => number;
  /**
   * Optional post-tick hook (P2-D-3): given the tick's authoritative state and its aggregate
   * contribution delta, the checkpointer folds it into the durable record. Awaited so a checkpoint
   * write can't be lost, but off the broadcast critical path.
   */
  onTick?: (snapshot: TickSnapshot, contribDelta: number) => void | Promise<void>;
}

export interface TickLoop {
  /** Run a single tick, advancing lifecycle timing by `dtMs`. Returns the broadcast snapshot. */
  runOnce(dtMs: number): Promise<TickSnapshot>;
  /** Start a real interval at `tickHz`. */
  start(): void;
  /** Stop the interval. */
  stop(): void;
}

export function createTickLoop(deps: TickLoopDeps): TickLoop {
  const { engine, aggregator, metrics, tickHz, now, broadcast, onTick } = deps;
  if (tickHz <= 0) throw new Error('tickHz must be > 0');
  const intervalMs = 1000 / tickHz;

  let timer: ReturnType<typeof setInterval> | null = null;
  let lastTs: number | null = null;

  const runOnce = async (dtMs: number): Promise<TickSnapshot> => {
    const sample = aggregator.sample();
    const eventState = await engine.tick(dtMs, sample);
    const snapshot: TickSnapshot = {
      eventState,
      aggregateStats: sample.stats,
      serverTs: now(),
    };
    const frame = encode({ type: 'tick', snapshot });
    const bytesPerClient = Buffer.byteLength(frame, 'utf8');
    broadcast(frame);
    metrics.recordTick(bytesPerClient);
    if (onTick) await onTick(snapshot, sample.stats.contribDelta);
    return snapshot;
  };

  return {
    runOnce,
    start() {
      if (timer) return;
      lastTs = now();
      timer = setInterval(() => {
        const ts = now();
        const dtMs = lastTs === null ? intervalMs : ts - lastTs;
        lastTs = ts;
        void runOnce(dtMs);
      }, intervalMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
