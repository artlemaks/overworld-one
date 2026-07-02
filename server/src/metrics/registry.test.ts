import { describe, it, expect } from 'vitest';
import { createMetrics } from './registry.js';

describe('metrics registry', () => {
  it('measures tick rate over the rolling window', () => {
    let t = 0;
    const m = createMetrics({ now: () => t, rateWindowMs: 1000 });
    for (let i = 0; i < 4; i++) {
      t += 250;
      m.recordTick(200);
    }
    // 4 ticks in the last 1000ms -> 4 Hz
    expect(m.snapshot().tickHz).toBe(4);
  });

  it('reports per-client bandwidth from tick payload sizes', () => {
    let t = 0;
    const m = createMetrics({ now: () => t, rateWindowMs: 1000 });
    t = 100;
    m.recordTick(300);
    t = 600;
    m.recordTick(300);
    // 600 bytes across a 1s window -> 600 B/s per client
    expect(m.snapshot().bytesPerClientPerSec).toBe(600);
  });

  it('computes latency percentiles', () => {
    const m = createMetrics();
    for (let i = 1; i <= 100; i++) m.recordLatency(i);
    const s = m.snapshot().latencyMs;
    expect(s.p50).toBeGreaterThanOrEqual(50);
    expect(s.p95).toBeGreaterThanOrEqual(95);
    expect(s.count).toBe(100);
  });

  it('counts accepted vs rejected contributions', () => {
    const m = createMetrics();
    m.recordContribution(true);
    m.recordContribution(true);
    m.recordContribution(false);
    const s = m.snapshot();
    expect(s.contributionsAccepted).toBe(2);
    expect(s.contributionsRejected).toBe(1);
  });

  it('renders Prometheus exposition text', () => {
    const m = createMetrics();
    m.setConnectedClients(42);
    const text = m.renderPrometheus();
    expect(text).toMatch(/overworld_connected_clients 42/);
    expect(text).toMatch(/overworld_tick_hz/);
    expect(text).toMatch(/overworld_bytes_per_client_per_sec/);
  });
});
