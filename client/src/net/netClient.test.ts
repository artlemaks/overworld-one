import { describe, it, expect } from 'vitest';
import { encode, type ServerMessage, type TickSnapshot } from '@overworld/shared';
import {
  computeBackoffMs,
  interpolateSnapshots,
  createNetClient,
  type NetSocket,
  type NetSocketHandlers,
  type BufferedSnapshot,
} from './netClient.js';

describe('computeBackoffMs', () => {
  it('grows exponentially from the base', () => {
    expect(computeBackoffMs(0, { baseMs: 500, factor: 2, maxMs: 10_000 })).toBe(500);
    expect(computeBackoffMs(1, { baseMs: 500, factor: 2, maxMs: 10_000 })).toBe(1000);
    expect(computeBackoffMs(2, { baseMs: 500, factor: 2, maxMs: 10_000 })).toBe(2000);
  });

  it('caps at maxMs', () => {
    expect(computeBackoffMs(20, { baseMs: 500, factor: 2, maxMs: 10_000 })).toBe(10_000);
  });
});

const snap = (bossHp: number, extra: Partial<TickSnapshot['eventState']> = {}): TickSnapshot => ({
  eventState: {
    bossHp,
    phase: 'phase-1',
    phaseProgressPct: 0,
    contribWaveCount: 0,
    playersContributingNow: 0,
    ...extra,
  },
  aggregateStats: { contribDelta: 0, contribRate: 0 },
  serverTs: 0,
});

describe('interpolateSnapshots', () => {
  it('returns null for an empty buffer', () => {
    expect(interpolateSnapshots([], 100)).toBeNull();
  });

  it('returns the only snapshot when the buffer holds one', () => {
    const buf: BufferedSnapshot[] = [{ snapshot: snap(900), arrivalTs: 0 }];
    expect(interpolateSnapshots(buf, 500)?.bossHp).toBe(900);
  });

  it('lerps continuous fields between two bracketing snapshots', () => {
    const buf: BufferedSnapshot[] = [
      { snapshot: snap(1000), arrivalTs: 0 },
      { snapshot: snap(800), arrivalTs: 100 },
    ];
    // Halfway in arrival time -> halfway in HP.
    expect(interpolateSnapshots(buf, 50)?.bossHp).toBe(900);
  });

  it('clamps to the newest snapshot past the end', () => {
    const buf: BufferedSnapshot[] = [
      { snapshot: snap(1000), arrivalTs: 0 },
      { snapshot: snap(800), arrivalTs: 100 },
    ];
    expect(interpolateSnapshots(buf, 999)?.bossHp).toBe(800);
  });
});

/** A fake socket factory the test drives by hand. */
function fakeFactory() {
  const sockets: Array<{
    handlers: NetSocketHandlers;
    sent: string[];
    closed: boolean;
    net: NetSocket;
  }> = [];
  const factory = (_url: string, handlers: NetSocketHandlers): NetSocket => {
    const entry = { handlers, sent: [] as string[], closed: false, net: {} as NetSocket };
    entry.net = {
      send: (d) => entry.sent.push(d),
      close: () => {
        entry.closed = true;
      },
    };
    sockets.push(entry);
    return entry.net;
  };
  return { factory, sockets };
}

const send = (entry: { handlers: NetSocketHandlers }, msg: ServerMessage): void =>
  entry.handlers.onMessage(encode(msg));

describe('createNetClient', () => {
  it('joins automatically on open', () => {
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({ url: 'ws://x', playerId: 'p1', connect: factory });
    client.start();
    expect(client.status()).toBe('connecting');
    sockets[0]!.handlers.onOpen();
    expect(client.status()).toBe('open');
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'join', playerId: 'p1' });
  });

  it('captures bossHpMax from welcome and buffers ticks for rendering', () => {
    let t = 0;
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({ url: 'ws://x', playerId: 'p1', connect: factory, now: () => t });
    client.start();
    sockets[0]!.handlers.onOpen();
    send(sockets[0]!, { type: 'welcome', playerId: 'p1', bossHpMax: 1000, tickHz: 4, serverTs: 0 });
    expect(client.bossHpMax()).toBe(1000);

    t = 0;
    send(sockets[0]!, { type: 'tick', snapshot: snap(900) });
    t = 100;
    send(sockets[0]!, { type: 'tick', snapshot: snap(800) });
    expect(client.latestState()?.bossHp).toBe(800);
    // Render behind by the default 250ms delay -> clamps to oldest buffered.
    expect(client.renderState(200)?.bossHp).toBe(900);
  });

  it('reconciles the optimistic personal score against the server ack', () => {
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({ url: 'ws://x', playerId: 'p1', connect: factory });
    client.start();
    sockets[0]!.handlers.onOpen();

    const seq = client.sendContribution(
      { playerId: 'p1', actionType: 'strike', inputParams: {}, clientTs: 0 },
      50,
    );
    expect(client.displayScore()).toBe(50); // optimistic

    send(sockets[0]!, { type: 'contribAck', seq, accepted: true, points: 42 });
    expect(client.displayScore()).toBe(42); // reconciled to authoritative
  });

  it('rolls back the optimistic score when the server rejects the contribution', () => {
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({ url: 'ws://x', playerId: 'p1', connect: factory });
    client.start();
    sockets[0]!.handlers.onOpen();
    const seq = client.sendContribution(
      { playerId: 'p1', actionType: 'strike', inputParams: {}, clientTs: 0 },
      50,
    );
    send(sockets[0]!, { type: 'contribAck', seq, accepted: false, points: 0, reason: 'rate_limited' });
    expect(client.displayScore()).toBe(0);
  });

  it('replies to a server ping with a pong', () => {
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({ url: 'ws://x', playerId: 'p1', connect: factory });
    client.start();
    sockets[0]!.handlers.onOpen();
    sockets[0]!.sent.length = 0;
    send(sockets[0]!, { type: 'ping', ts: 123 });
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ type: 'pong', ts: 123 });
  });

  it('reconnects with backoff after an unexpected close', () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({
      url: 'ws://x',
      playerId: 'p1',
      connect: factory,
      schedule: (fn, ms) => scheduled.push({ fn, ms }),
    });
    client.start();
    sockets[0]!.handlers.onOpen();

    sockets[0]!.handlers.onClose();
    expect(client.status()).toBe('reconnecting');
    expect(scheduled[0]!.ms).toBe(500); // first backoff

    scheduled[0]!.fn(); // fire the reconnect
    expect(sockets).toHaveLength(2);
    sockets[1]!.handlers.onOpen();
    expect(client.status()).toBe('open');
  });

  it('does not reconnect after an explicit stop', () => {
    const scheduled: Array<{ fn: () => void; ms: number }> = [];
    const { factory, sockets } = fakeFactory();
    const client = createNetClient({
      url: 'ws://x',
      playerId: 'p1',
      connect: factory,
      schedule: (fn, ms) => scheduled.push({ fn, ms }),
    });
    client.start();
    sockets[0]!.handlers.onOpen();
    client.stop();
    sockets[0]!.handlers.onClose();
    expect(client.status()).toBe('closed');
    expect(scheduled).toHaveLength(0);
  });
});
