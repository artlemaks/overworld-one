import {
  decodeClientMessage,
  encode,
  type ContributionMessage,
  type ServerMessage,
} from '@overworld/shared';
import type { Transport, ClientSocket } from './transport.js';
import type { Metrics } from '../metrics/registry.js';
import type { IngestResult } from '../ingest.js';
import { createLogger, type Logger } from '@overworld/shared';

/**
 * WS game server: connection lifecycle + heartbeat (P1-S-1 / OOM-25).
 *
 * Sits on top of the {@link Transport} seam and owns the per-connection protocol state machine:
 *  - **join** → validate identity, reply `welcome` (with the authoritative `bossHpMax`, so the client
 *    stops hardcoding it), start counting the client as present;
 *  - **contribution** → hand to the injected ingest pipeline, reply `contribAck` with the server's
 *    authoritative points for the client to reconcile against (P1-C-1);
 *  - **pong** → measure round-trip latency into {@link Metrics};
 *  - **heartbeat** → ping every client on an interval and drop any that stopped answering, so dead
 *    sockets don't inflate the presence/bandwidth numbers.
 *
 * The ingest step is injected (`processContribution`) so this module stays decoupled from Redis and is
 * unit-testable against a fake transport.
 */

export interface GameServerDeps {
  transport: Transport;
  metrics: Metrics;
  bossHpMax: number;
  tickHz: number;
  now: () => number;
  /** Ingest a validated contribution keyed by rate-limit key; returns the authoritative result. */
  processContribution: (msg: ContributionMessage, rateKey: string) => Promise<IngestResult>;
  /** Heartbeat interval in ms. A client silent for 2× this is dropped. */
  heartbeatMs?: number;
  logger?: Logger;
}

interface ConnState {
  socket: ClientSocket;
  playerId: string | null;
  lastSeenTs: number;
}

export interface GameServer {
  /** Broadcast an already-encoded frame (used by the tick loop). */
  broadcast(frame: string): number;
  /** Run one heartbeat sweep: ping all, drop the unresponsive. Exposed for deterministic tests. */
  heartbeatSweep(): void;
  /** Start the real heartbeat interval. */
  start(): void;
  stop(): void;
  connectionCount(): number;
}

export function createGameServer(deps: GameServerDeps): GameServer {
  const logger = deps.logger ?? createLogger('ws');
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const conns = new Map<string, ConnState>();

  const send = (socket: ClientSocket, msg: ServerMessage): void => socket.send(encode(msg));
  const syncPresence = (): void => deps.metrics.setConnectedClients(conns.size);

  deps.transport.onConnection((socket) => {
    conns.set(socket.id, { socket, playerId: null, lastSeenTs: deps.now() });
    syncPresence();
  });

  deps.transport.onClose((socket) => {
    conns.delete(socket.id);
    syncPresence();
  });

  deps.transport.onMessage((socket, raw) => {
    const conn = conns.get(socket.id);
    if (!conn) return;
    conn.lastSeenTs = deps.now();

    let msg;
    try {
      msg = decodeClientMessage(raw);
    } catch {
      send(socket, { type: 'error', code: 'bad_frame', message: 'unparseable message' });
      return;
    }

    switch (msg.type) {
      case 'join': {
        conn.playerId = msg.playerId;
        send(socket, {
          type: 'welcome',
          playerId: msg.playerId,
          bossHpMax: deps.bossHpMax,
          tickHz: deps.tickHz,
          serverTs: deps.now(),
        });
        return;
      }
      case 'contribution': {
        if (!conn.playerId) {
          send(socket, { type: 'error', code: 'not_joined', message: 'join before contributing' });
          return;
        }
        // The socket's identity is authoritative — never trust a playerId smuggled in the payload.
        const contribution: ContributionMessage = {
          ...msg.contribution,
          playerId: conn.playerId,
        };
        void deps.processContribution(contribution, `ip:${socket.remoteIp}`).then((result) => {
          send(socket, {
            type: 'contribAck',
            seq: msg.seq,
            accepted: result.accepted,
            points: result.points,
            reason: result.reason,
          });
        });
        return;
      }
      case 'pong': {
        deps.metrics.recordLatency(Math.max(0, deps.now() - msg.ts));
        return;
      }
    }
  });

  const heartbeatSweep = (): void => {
    const ts = deps.now();
    for (const conn of [...conns.values()]) {
      if (ts - conn.lastSeenTs > heartbeatMs * 2) {
        logger.debug('dropping unresponsive client', { id: conn.socket.id });
        conn.socket.close();
        conns.delete(conn.socket.id);
        continue;
      }
      send(conn.socket, { type: 'ping', ts });
    }
    syncPresence();
  };

  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    broadcast(frame) {
      return deps.transport.broadcast(frame);
    },
    heartbeatSweep,
    start() {
      if (!timer) timer = setInterval(heartbeatSweep, heartbeatMs);
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    connectionCount() {
      return conns.size;
    },
  };
}
