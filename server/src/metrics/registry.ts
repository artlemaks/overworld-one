/**
 * Real-time observability (P1-X-1 / OOM-33).
 *
 * The P1 DoD is stated in numbers — "per-client bandwidth constant (±5%)", "tick ≥ 3 Hz stable",
 * latency percentiles — so it is only *verifiable* if the server measures them. This registry is the
 * baseline dashboard's data source: it records the handful of real-time signals and renders them both
 * as a JSON {@link MetricsSnapshot} and as Prometheus text for `/metrics`. Built on the P-1 logging
 * baseline (`observability.ts`); dependency-free and clock-injectable so it is unit-testable.
 */

/** Percentile summary of a latency distribution. */
export interface LatencySummary {
  p50: number;
  p95: number;
  p99: number;
  count: number;
}

export interface MetricsSnapshot {
  connectedClients: number;
  /** Measured tick rate over the last second — must hold ≥ 3 (P1 DoD). */
  tickHz: number;
  /** Measured bytes sent to each client per second — must stay constant regardless of CCU. */
  bytesPerClientPerSec: number;
  /** Round-trip latency from ping/pong, in ms. */
  latencyMs: LatencySummary;
  /** Redis op latency, in ms. */
  redisOpMs: LatencySummary;
  /** Contributions waiting to be processed (backpressure signal). */
  ingestQueueDepth: number;
  contributionsAccepted: number;
  contributionsRejected: number;
}

/** Bounded reservoir with percentile queries. Keeps the most recent `capacity` samples. */
class Reservoir {
  private samples: number[] = [];
  constructor(private readonly capacity = 1024) {}

  record(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  summary(): LatencySummary {
    const n = this.samples.length;
    if (n === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
    const sorted = [...this.samples].sort((a, b) => a - b);
    const at = (q: number): number => sorted[Math.min(n - 1, Math.floor(q * n))] ?? 0;
    return { p50: at(0.5), p95: at(0.95), p99: at(0.99), count: n };
  }
}

export interface MetricsOptions {
  /** Injectable clock (epoch ms). Defaults to `Date.now`. */
  now?: () => number;
  /** Rolling window for the tick-rate + bandwidth rate calc. */
  rateWindowMs?: number;
}

export interface Metrics {
  setConnectedClients(n: number): void;
  setIngestQueueDepth(n: number): void;
  /** Called once per tick broadcast with the per-client payload size. */
  recordTick(bytesPerClient: number): void;
  recordLatency(ms: number): void;
  recordRedisOp(ms: number): void;
  recordContribution(accepted: boolean): void;
  snapshot(): MetricsSnapshot;
  /** Render the snapshot as Prometheus exposition text for the `/metrics` endpoint. */
  renderPrometheus(): string;
}

export function createMetrics(opts: MetricsOptions = {}): Metrics {
  const now = opts.now ?? (() => Date.now());
  const rateWindowMs = opts.rateWindowMs ?? 1000;

  const latency = new Reservoir();
  const redisOp = new Reservoir();
  const ticks: Array<{ ts: number; bytes: number }> = [];

  let connectedClients = 0;
  let ingestQueueDepth = 0;
  let accepted = 0;
  let rejected = 0;

  const pruneTicks = (ts: number): void => {
    const cutoff = ts - rateWindowMs;
    while (ticks.length > 0) {
      const head = ticks[0];
      if (head === undefined || head.ts > cutoff) break;
      ticks.shift();
    }
  };

  return {
    setConnectedClients(n) {
      connectedClients = n;
    },
    setIngestQueueDepth(n) {
      ingestQueueDepth = n;
    },
    recordTick(bytesPerClient) {
      ticks.push({ ts: now(), bytes: bytesPerClient });
      pruneTicks(now());
    },
    recordLatency(ms) {
      latency.record(ms);
    },
    recordRedisOp(ms) {
      redisOp.record(ms);
    },
    recordContribution(ok) {
      if (ok) accepted += 1;
      else rejected += 1;
    },
    snapshot() {
      const ts = now();
      pruneTicks(ts);
      const windowSec = rateWindowMs / 1000;
      const tickHz = ticks.length / windowSec;
      // Per-client bandwidth = bytes summed over the window / window seconds (already per-client).
      const bytesPerClientPerSec = ticks.reduce((s, t) => s + t.bytes, 0) / windowSec;
      return {
        connectedClients,
        tickHz,
        bytesPerClientPerSec,
        latencyMs: latency.summary(),
        redisOpMs: redisOp.summary(),
        ingestQueueDepth,
        contributionsAccepted: accepted,
        contributionsRejected: rejected,
      };
    },
    renderPrometheus() {
      const s = this.snapshot();
      const lines = [
        `overworld_connected_clients ${s.connectedClients}`,
        `overworld_tick_hz ${s.tickHz.toFixed(3)}`,
        `overworld_bytes_per_client_per_sec ${s.bytesPerClientPerSec.toFixed(1)}`,
        `overworld_ingest_queue_depth ${s.ingestQueueDepth}`,
        `overworld_contributions_total{result="accepted"} ${s.contributionsAccepted}`,
        `overworld_contributions_total{result="rejected"} ${s.contributionsRejected}`,
        `overworld_latency_ms{quantile="0.5"} ${s.latencyMs.p50}`,
        `overworld_latency_ms{quantile="0.95"} ${s.latencyMs.p95}`,
        `overworld_latency_ms{quantile="0.99"} ${s.latencyMs.p99}`,
        `overworld_redis_op_ms{quantile="0.5"} ${s.redisOpMs.p50}`,
        `overworld_redis_op_ms{quantile="0.95"} ${s.redisOpMs.p95}`,
        `overworld_redis_op_ms{quantile="0.99"} ${s.redisOpMs.p99}`,
      ];
      return lines.join('\n') + '\n';
    },
  };
}
