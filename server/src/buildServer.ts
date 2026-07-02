import type { ContributionMessage, Env } from '@overworld/shared';
import type { CounterStore } from './state/counters.js';
import type { PubSub } from './state/pubsub.js';
import type { Transport } from './net/transport.js';
import { createEventEngine, type EventEngine } from './game/event.js';
import { createAggregator } from './game/aggregation.js';
import { createTickLoop, type TickLoop } from './game/tickLoop.js';
import { createTokenBucketLimiter } from './game/ratelimit.js';
import { createAnomalyDetector } from './game/anticheat.js';
import { ingestContribution, type IngestResult } from './ingest.js';
import { createMetrics, type Metrics } from './metrics/registry.js';
import { createGameServer, type GameServer } from './net/wsServer.js';

/**
 * Composition root for the P1 real-time core.
 *
 * Wires the pure modules — counter, pub/sub, engine, aggregator, ingest, tick loop, WS server, metrics
 * — into one running graph, given injected *stores* and a *transport*. Keeping the wiring here (not in
 * `index.ts`) lets the load harness build the identical graph with in-memory stores and drive it with
 * real sockets, so the harness exercises the real code path rather than a mock.
 */

/** The single P1 event. Reskins/multiple events arrive in P3. */
export const EVENT_ID = 'p1-boss';

/** Tuning constants for the P1 gate (kept together so the harness and server agree). */
export const P1_TUNING = {
  bossHpMax: 1_000_000,
  aggregationWindowMs: 1000,
  /** Rate limiter: small burst, ~human sustained rate. */
  rateCapacity: 5,
  rateRefillPerSec: 5,
  /** Anti-cheat: flag anyone sustaining > 10 contributions/s. */
  anomalyMaxRatePerSec: 10,
  anomalyWindowMs: 1000,
  heartbeatMs: 15_000,
} as const;

export interface BuildServerOptions {
  env: Env;
  counterStore: CounterStore;
  pubsub: PubSub;
  transport: Transport;
  now?: () => number;
  /** Override boss HP (the harness scales it to population). */
  bossHpMax?: number;
}

export interface BuiltServer {
  engine: EventEngine;
  metrics: Metrics;
  tickLoop: TickLoop;
  gameServer: GameServer;
  processContribution: (msg: ContributionMessage, rateKey: string) => Promise<IngestResult>;
  /** Initialise the counter and start the tick + heartbeat loops. */
  start(): Promise<void>;
  /** Stop the loops (does not close injected stores/transport). */
  stop(): void;
}

export async function buildServer(opts: BuildServerOptions): Promise<BuiltServer> {
  const now = opts.now ?? (() => Date.now());
  const bossHpMax = opts.bossHpMax ?? P1_TUNING.bossHpMax;

  const engine = createEventEngine(opts.counterStore, {
    eventId: EVENT_ID,
    hpMax: bossHpMax,
    direction: 'down',
  });

  const metrics = createMetrics({ now });
  const aggregator = createAggregator({ windowMs: P1_TUNING.aggregationWindowMs, now });

  // Every accepted contribution — from this node or any other, via pub/sub — feeds the aggregator.
  await opts.pubsub.subscribe((event) => aggregator.record(event));

  const limiter = createTokenBucketLimiter({
    capacity: P1_TUNING.rateCapacity,
    refillPerSec: P1_TUNING.rateRefillPerSec,
    now,
  });
  const detector = createAnomalyDetector({
    maxRatePerSec: P1_TUNING.anomalyMaxRatePerSec,
    windowMs: P1_TUNING.anomalyWindowMs,
    now,
  });

  const processContribution = (msg: ContributionMessage, rateKey: string): Promise<IngestResult> =>
    ingestContribution(
      { eventId: EVENT_ID, engine, pubsub: opts.pubsub, limiter, detector, metrics, now },
      msg,
      rateKey,
    );

  const gameServer = createGameServer({
    transport: opts.transport,
    metrics,
    bossHpMax,
    tickHz: opts.env.TICK_HZ,
    now,
    processContribution,
    heartbeatMs: P1_TUNING.heartbeatMs,
  });

  const tickLoop = createTickLoop({
    engine,
    aggregator,
    metrics,
    tickHz: opts.env.TICK_HZ,
    now,
    broadcast: (frame) => gameServer.broadcast(frame),
  });

  return {
    engine,
    metrics,
    tickLoop,
    gameServer,
    processContribution,
    async start() {
      await engine.init();
      tickLoop.start();
      gameServer.start();
    },
    stop() {
      tickLoop.stop();
      gameServer.stop();
    },
  };
}
