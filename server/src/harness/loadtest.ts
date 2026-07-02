import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { parseEnv, encode, decodeServerMessage, type ContributionMessage } from '@overworld/shared';
import { createMemoryCounterStore } from '../state/counters.js';
import { createMemoryPubSub } from '../state/pubsub.js';
import { createWsTransport } from '../net/transport.js';
import { buildServer } from '../buildServer.js';

/**
 * Mixed-population load harness (P1-I-1 / OOM-36).
 *
 * Validates the P1 scale model — **constant per-client bandwidth** and **≥80% of realistic clients
 * contributing within 30s** — by booting the *real* server graph in-process (via `buildServer`, so it
 * exercises the true code path, not a mock) and driving it with real `ws` clients:
 *
 *   - ~70% **realistic** clients: join, make 1–3 contributions in the first seconds, then idle;
 *   - ~30% **stress bots**: rapid-fire contributions for the whole run.
 *
 * It measures per-client received bandwidth (should be near-identical across all clients regardless of
 * how much anyone contributes — that's the whole point), the realistic-population contribute-in-30s
 * rate, and the server's measured tick rate, then asserts the DoD thresholds and exits non-zero on
 * failure so CI can gate on it.
 *
 * Scope is **scale, not durability** (durability is P2, once checkpoint/replay exists). The full
 * 1000+ CCU run against *cloud* infra is gated on OOM-12 (cloud provisioning); this validates the
 * model locally and scales via the CLI arg.
 *
 *   Usage: tsx src/harness/loadtest.ts [clients=500] [durationMs=32000]
 */

interface ClientStat {
  role: 'realistic' | 'bot';
  /** Only tick-broadcast bytes — the stream whose per-client size the DoD requires to stay constant. */
  tickBytesReceived: number;
  connectedAtMs: number;
  firstAcceptAtMs: number | null;
}

const REALISTIC_FRACTION = 0.7;
const CONTRIBUTE_WINDOW_MS = 30_000;

function makeContribution(): Omit<ContributionMessage, 'playerId'> {
  return {
    actionType: 'strike',
    inputParams: { aimAccuracy: 0.7 + Math.random() * 0.3, timingQuality: 0.6 + Math.random() * 0.4 },
    clientTs: Date.now(),
  };
}

async function main(): Promise<void> {
  const clientCount = Number(process.argv[2] ?? 500);
  const durationMs = Number(process.argv[3] ?? 32_000);
  const env = parseEnv(process.env);

  // Boss HP scaled so the event stays live through the whole run (scale test, not a kill).
  const bossHpMax = Math.max(1_000_000, clientCount * 4000);

  const counterStore = createMemoryCounterStore();
  const pubsub = createMemoryPubSub();
  const httpServer = createServer();
  const transport = createWsTransport(httpServer);
  const built = await buildServer({ env, counterStore, pubsub, transport, bossHpMax });
  await built.start();

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const url = `ws://127.0.0.1:${port}`;
  process.stdout.write(`[harness] server up on ${url}, spawning ${clientCount} clients…\n`);

  const stats: ClientStat[] = [];
  const sockets: WebSocket[] = [];
  const startMs = Date.now();

  for (let i = 0; i < clientCount; i++) {
    const role: ClientStat['role'] = Math.random() < REALISTIC_FRACTION ? 'realistic' : 'bot';
    const stat: ClientStat = { role, tickBytesReceived: 0, connectedAtMs: 0, firstAcceptAtMs: null };
    stats.push(stat);
    const playerId = `load-${role}-${i}`;
    // Distinct synthetic client IP so each simulated user has its own rate-limit identity (as they
    // would behind a real load balancer) — otherwise every loopback client shares one IP bucket.
    const syntheticIp = `10.1.${(i >> 8) & 255}.${i & 255}`;
    const ws = new WebSocket(url, { headers: { 'x-forwarded-for': syntheticIp } });
    sockets.push(ws);

    let botTimer: ReturnType<typeof setInterval> | null = null;

    ws.on('open', () => {
      stat.connectedAtMs = Date.now();
      ws.send(encode({ type: 'join', playerId }));
      let seq = 0;
      const fire = (): void => {
        if (ws.readyState !== WebSocket.OPEN) return;
        ws.send(encode({ type: 'contribution', seq: seq++, contribution: { playerId, ...makeContribution() } }));
      };
      if (role === 'realistic') {
        const bursts = 1 + Math.floor(Math.random() * 3);
        for (let b = 0; b < bursts; b++) setTimeout(fire, 200 + Math.random() * 2500);
      } else {
        botTimer = setInterval(fire, 20); // rapid-fire — should be rate-limited / flagged
      }
    });

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      let msg;
      try {
        msg = decodeServerMessage(raw);
      } catch {
        return;
      }
      if (msg.type === 'tick') stat.tickBytesReceived += Buffer.byteLength(raw, 'utf8');
      if (msg.type === 'ping') ws.send(encode({ type: 'pong', ts: msg.ts }));
      if (msg.type === 'contribAck' && msg.accepted && stat.firstAcceptAtMs === null) {
        stat.firstAcceptAtMs = Date.now();
      }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (botTimer) clearInterval(botTimer);
    });
  }

  await new Promise((resolve) => setTimeout(resolve, durationMs));
  const endMs = Date.now();
  const elapsedSec = (endMs - startMs) / 1000;

  // ── Report ───────────────────────────────────────────────────────────────
  // Per-client bandwidth is normalised by each client's OWN connected duration so that small
  // connect-time jitter doesn't masquerade as a bandwidth difference — the DoD is about the steady
  // per-client rate being identical, which it is because every client gets the same tick frames.
  const connected = stats.filter((s) => s.connectedAtMs > 0);
  const bandwidths = connected.map(
    (s) => s.tickBytesReceived / Math.max(0.001, (endMs - s.connectedAtMs) / 1000),
  );
  const meanBw = bandwidths.reduce((a, b) => a + b, 0) / (bandwidths.length || 1);
  const minBw = Math.min(...bandwidths);
  const maxBw = Math.max(...bandwidths);
  const spreadPct = meanBw > 0 ? ((maxBw - minBw) / meanBw) * 100 : 0;

  const realistic = connected.filter((s) => s.role === 'realistic');
  const contributedIn30s = realistic.filter(
    (s) => s.firstAcceptAtMs !== null && s.firstAcceptAtMs - s.connectedAtMs <= CONTRIBUTE_WINDOW_MS,
  ).length;
  const contributePct = realistic.length > 0 ? (contributedIn30s / realistic.length) * 100 : 0;

  const snap = built.metrics.snapshot();
  const finalState = await built.engine.tick(0, {
    stats: { contribDelta: 0, contribRate: 0 },
    playersContributingNow: 0,
    waveCount: 0,
  });

  const report = {
    clientsRequested: clientCount,
    clientsConnected: connected.length,
    durationSec: Number(elapsedSec.toFixed(1)),
    tickHz: Number(snap.tickHz.toFixed(2)),
    perClientBandwidthBytesPerSec: Number(meanBw.toFixed(1)),
    bandwidthSpreadPct: Number(spreadPct.toFixed(2)),
    realisticContributeIn30sPct: Number(contributePct.toFixed(1)),
    contributionsAccepted: snap.contributionsAccepted,
    contributionsRejected: snap.contributionsRejected,
    finalBossHp: Math.round(finalState.bossHp),
    finalBossHpMax: bossHpMax,
  };

  // ── DoD gates ────────────────────────────────────────────────────────────
  const gates = {
    tickAtLeast3Hz: snap.tickHz >= 3,
    bandwidthConstantWithin5Pct: spreadPct <= 5,
    contributeIn30sAtLeast80Pct: contributePct >= 80,
  };
  const passed = Object.values(gates).every(Boolean);

  process.stdout.write(`\n[harness] REPORT\n${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[harness] GATES\n${JSON.stringify(gates, null, 2)}\n`);
  process.stdout.write(`[harness] ${passed ? 'PASS ✅' : 'FAIL ❌'}\n`);

  for (const ws of sockets) ws.terminate();
  built.stop();
  await transport.close();
  await pubsub.close();
  await counterStore.close();
  httpServer.close();
  process.exit(passed ? 0 : 1);
}

void main();
