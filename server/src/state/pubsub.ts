import type Redis from 'ioredis';

/**
 * Pub/sub fan-out across stateless WS nodes (P1-S-6 / OOM-30).
 *
 * Contributions can land on *any* node (clients are sharded across a fleet behind a load balancer),
 * but every node must see every contribution so its local aggregation window — the "contribution
 * waves" and "players now" presence sampled into each tick (P1-S-5/7) — reflects the whole population,
 * not just the clients it happens to hold. Each accepted contribution is published as a
 * {@link ContribEvent}; every node subscribes and feeds its aggregator.
 *
 * The authoritative counter itself is *not* reconstructed from this stream — that lives in Redis and
 * is mutated atomically (`counters.ts`). Pub/sub carries only the derived, sampled aggregates, so a
 * dropped message costs at most a little presence jitter, never counter integrity.
 */

/** One accepted contribution, broadcast to every node's aggregator. */
export interface ContribEvent {
  eventId: string;
  playerId: string;
  /** Authoritative points the server computed for this contribution. */
  points: number;
  /** Signed counter delta applied (e.g. negative for boss HP). */
  delta: number;
  /** Server time the contribution was accepted (epoch ms). */
  ts: number;
}

export type ContribHandler = (event: ContribEvent) => void;

export interface PubSub {
  /** Broadcast an accepted contribution to all subscribers (including this node). */
  publish(event: ContribEvent): Promise<void>;
  /** Register a handler for every published {@link ContribEvent}. */
  subscribe(handler: ContribHandler): Promise<void>;
  close(): Promise<void>;
}

const CHANNEL = 'overworld:contrib';

/**
 * Single-process pub/sub — handlers fire synchronously on publish. Models a one-node deployment and
 * backs the unit/integration tests and the load harness without a Redis dependency.
 */
export function createMemoryPubSub(): PubSub {
  const handlers = new Set<ContribHandler>();
  return {
    async publish(event) {
      for (const h of handlers) h(event);
    },
    async subscribe(handler) {
      handlers.add(handler);
    },
    async close() {
      handlers.clear();
    },
  };
}

/**
 * Redis pub/sub — the production fan-out. Requires two connections because an ioredis client in
 * subscriber mode cannot issue normal commands: `pub` publishes, `sub` receives. Both are owned by
 * the caller (wired in `index.ts`) and closed here.
 */
export function createRedisPubSub(pub: Redis, sub: Redis): PubSub {
  const handlers = new Set<ContribHandler>();
  let wired = false;

  return {
    async publish(event) {
      await pub.publish(CHANNEL, JSON.stringify(event));
    },
    async subscribe(handler) {
      handlers.add(handler);
      if (!wired) {
        wired = true;
        await sub.subscribe(CHANNEL);
        sub.on('message', (_channel, raw) => {
          const event = JSON.parse(raw) as ContribEvent;
          for (const h of handlers) h(event);
        });
      }
    },
    async close() {
      handlers.clear();
      await Promise.all([pub.quit(), sub.quit()]);
    },
  };
}
