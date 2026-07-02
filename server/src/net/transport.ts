import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'node:http';

/**
 * Transport seam (P1 decision gate — ADR-002).
 *
 * P1 ships on the pure-JS `ws` library, but the game logic never imports `ws` directly — it talks to
 * this small {@link Transport} interface. That keeps the core testable against a fake transport and
 * lets P5 swap in uWebSockets.js for the soak test without touching a line of game code. The interface
 * exposes only what the server needs: per-socket send/close, a whole-fleet broadcast, and lifecycle
 * callbacks.
 */

/** One connected client, transport-agnostic. */
export interface ClientSocket {
  readonly id: string;
  /** Best-effort IP for the P1 IP-keyed rate limiter (P1-S-4). */
  readonly remoteIp: string;
  send(data: string): void;
  close(): void;
}

export interface Transport {
  onConnection(handler: (socket: ClientSocket) => void): void;
  onMessage(handler: (socket: ClientSocket, raw: string) => void): void;
  onClose(handler: (socket: ClientSocket) => void): void;
  /** Send `data` to every connected client; returns the number sent. */
  broadcast(data: string): number;
  clientCount(): number;
  close(): Promise<void>;
}

/**
 * `ws`-backed transport. Attaches a {@link WebSocketServer} to an existing HTTP server (so `/healthz`
 * and `/metrics` share the port) and adapts each raw socket to a {@link ClientSocket}.
 */
export function createWsTransport(httpServer: Server): Transport {
  const wss = new WebSocketServer({ server: httpServer });
  const sockets = new Map<string, { ws: WebSocket; client: ClientSocket }>();
  let seq = 0;

  const connectionHandlers: Array<(s: ClientSocket) => void> = [];
  const messageHandlers: Array<(s: ClientSocket, raw: string) => void> = [];
  const closeHandlers: Array<(s: ClientSocket) => void> = [];

  wss.on('connection', (ws, req) => {
    const id = `c${++seq}`;
    // Behind the production load balancer the real client IP arrives in x-forwarded-for; fall back to
    // the socket address for direct connections. (Trusting XFF is valid from the trusted LB only;
    // P5 anti-cheat hardening tightens this — for P1 it is the correct per-user rate-limit key.)
    const xff = req.headers['x-forwarded-for'];
    const forwarded = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    const remoteIp = forwarded || req.socket.remoteAddress || 'unknown';
    const client: ClientSocket = {
      id,
      remoteIp,
      send(data) {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close() {
        ws.close();
      },
    };
    sockets.set(id, { ws, client });

    for (const h of connectionHandlers) h(client);

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      for (const h of messageHandlers) h(client, raw);
    });
    ws.on('close', () => {
      sockets.delete(id);
      for (const h of closeHandlers) h(client);
    });
    ws.on('error', () => ws.close());
  });

  return {
    onConnection(handler) {
      connectionHandlers.push(handler);
    },
    onMessage(handler) {
      messageHandlers.push(handler);
    },
    onClose(handler) {
      closeHandlers.push(handler);
    },
    broadcast(data) {
      let sent = 0;
      for (const { ws } of sockets.values()) {
        if (ws.readyState === ws.OPEN) {
          ws.send(data);
          sent += 1;
        }
      }
      return sent;
    },
    clientCount() {
      return sockets.size;
    },
    async close() {
      for (const { ws } of sockets.values()) ws.terminate();
      sockets.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
