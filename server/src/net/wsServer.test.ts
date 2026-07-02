import { describe, it, expect, vi } from 'vitest';
import { decodeServerMessage, encode, type ContributionMessage } from '@overworld/shared';
import type { Transport, ClientSocket } from './transport.js';
import { createMetrics } from '../metrics/registry.js';
import { createGameServer } from './wsServer.js';
import type { IngestResult } from '../ingest.js';

/** A fake transport that lets a test drive connections, messages, and closes by hand. */
function createFakeTransport() {
  let onConn: (s: ClientSocket) => void = () => {};
  let onMsg: (s: ClientSocket, raw: string) => void = () => {};
  let onClose: (s: ClientSocket) => void = () => {};
  const transport: Transport = {
    onConnection: (h) => (onConn = h),
    onMessage: (h) => (onMsg = h),
    onClose: (h) => (onClose = h),
    broadcast: () => 0,
    clientCount: () => 0,
    close: async () => {},
  };
  let seq = 0;
  const connect = (ip = '1.2.3.4') => {
    const frames: string[] = [];
    let closed = false;
    const socket: ClientSocket = {
      id: `s${++seq}`,
      remoteIp: ip,
      send: (d) => frames.push(d),
      close: () => {
        closed = true;
      },
    };
    onConn(socket);
    return {
      socket,
      frames,
      isClosed: () => closed,
      send: (raw: string) => onMsg(socket, raw),
      last: () => decodeServerMessage(frames[frames.length - 1] ?? ''),
    };
  };
  return { transport, connect, disconnect: (s: ClientSocket) => onClose(s) };
}

const flush = () => new Promise((r) => setImmediate(r));

function build(processContribution: (m: ContributionMessage, k: string) => Promise<IngestResult>) {
  let t = 0;
  const fake = createFakeTransport();
  const metrics = createMetrics({ now: () => t });
  const server = createGameServer({
    transport: fake.transport,
    metrics,
    bossHpMax: 1000,
    tickHz: 4,
    now: () => t,
    processContribution,
    heartbeatMs: 100,
  });
  return { fake, metrics, server, setTime: (v: number) => (t = v) };
}

describe('WS game server', () => {
  it('replies to join with a welcome carrying the authoritative bossHpMax', () => {
    const { fake } = build(async () => ({ accepted: true, points: 10 }));
    const client = fake.connect();
    client.send(encode({ type: 'join', playerId: 'p1' }));
    const msg = client.last();
    expect(msg.type).toBe('welcome');
    if (msg.type === 'welcome') expect(msg.bossHpMax).toBe(1000);
  });

  it('rejects a contribution sent before joining', () => {
    const { fake } = build(async () => ({ accepted: true, points: 10 }));
    const client = fake.connect();
    client.send(encode({ type: 'contribution', seq: 0, contribution: contribution() }));
    const msg = client.last();
    expect(msg.type).toBe('error');
    if (msg.type === 'error') expect(msg.code).toBe('not_joined');
  });

  it('ingests a contribution under the socket identity and acks the authoritative points', async () => {
    const process = vi.fn(async () => ({ accepted: true, points: 42 }) as IngestResult);
    const { fake } = build(process);
    const client = fake.connect('9.9.9.9');
    client.send(encode({ type: 'join', playerId: 'real-id' }));
    // Client tries to smuggle a different playerId; the socket identity must win.
    client.send(encode({ type: 'contribution', seq: 7, contribution: contribution({ playerId: 'spoofed' }) }));
    await flush();

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({ playerId: 'real-id' }),
      'ip:9.9.9.9',
    );
    const ack = client.last();
    expect(ack.type).toBe('contribAck');
    if (ack.type === 'contribAck') {
      expect(ack.seq).toBe(7);
      expect(ack.points).toBe(42);
    }
  });

  it('measures latency from a pong', () => {
    const { fake, metrics, setTime } = build(async () => ({ accepted: true, points: 1 }));
    const client = fake.connect();
    client.send(encode({ type: 'join', playerId: 'p1' }));
    setTime(50);
    client.send(encode({ type: 'pong', ts: 0 }));
    expect(metrics.snapshot().latencyMs.count).toBe(1);
  });

  it('emits an error on an unparseable frame', () => {
    const { fake } = build(async () => ({ accepted: true, points: 1 }));
    const client = fake.connect();
    client.send('{not json');
    const msg = client.last();
    expect(msg.type).toBe('error');
    if (msg.type === 'error') expect(msg.code).toBe('bad_frame');
  });

  it('pings live clients and drops unresponsive ones on a heartbeat sweep', () => {
    const { fake, server, setTime } = build(async () => ({ accepted: true, points: 1 }));
    const client = fake.connect();
    client.send(encode({ type: 'join', playerId: 'p1' }));
    expect(server.connectionCount()).toBe(1);

    // Silent past 2× heartbeat -> dropped.
    setTime(1000);
    server.heartbeatSweep();
    expect(client.isClosed()).toBe(true);
    expect(server.connectionCount()).toBe(0);
  });
});

function contribution(over: Partial<ContributionMessage> = {}): ContributionMessage {
  return {
    playerId: 'p1',
    actionType: 'strike',
    inputParams: { aimAccuracy: 1, timingQuality: 1 },
    clientTs: 0,
    ...over,
  };
}
