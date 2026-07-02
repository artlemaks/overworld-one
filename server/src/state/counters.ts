import type Redis from 'ioredis';

/**
 * Authoritative event counters (P1-S-2 / OOM-26).
 *
 * The single source of truth for "where is the shared objective right now" lives in Redis, mutated
 * only through **atomic, clamped** deltas so that thousands of concurrent contributions can never
 * race a lost update. The counter is deliberately generic:
 *
 *  - **Boss** — `value = hp`, starts at `ceil`, contributions apply a *negative* delta, `floor = 0`.
 *  - **Structure** (P3 reskin) — `value = height`, starts at `floor`, contributions apply a *positive*
 *    delta, capped at `ceil`.
 *  - **Threat** (P3 reskin) — `value = distance`, moved either way within `[floor, ceil]`.
 *
 * Because the store only ever sees a signed delta clamped to `[floor, ceil]`, all three archetypes
 * share one schema and one atomic op — **no P3 migration** (the forward-design the task calls for).
 * The event layer decides the sign; the store just guarantees atomicity and the bounds.
 */

/** Immutable bounds + starting value for one event's authoritative counter. */
export interface CounterConfig {
  eventId: string;
  /** Starting value written on {@link CounterStore.init}. */
  initial: number;
  /** Hard lower bound (e.g. boss HP floor of 0). */
  floor: number;
  /** Hard upper bound (e.g. structure max height). */
  ceil: number;
}

export interface CounterStore {
  /** Set the counter to its initial value and remember its bounds. Overwrites any prior state. */
  init(cfg: CounterConfig): Promise<void>;
  /** Current authoritative value. */
  get(eventId: string): Promise<number>;
  /** Atomically add `delta`, clamp to the event's `[floor, ceil]`, and return the new value. */
  applyDelta(eventId: string, delta: number): Promise<number>;
  /** Drop all state for an event. */
  reset(eventId: string): Promise<void>;
  /** Release any underlying connection. */
  close(): Promise<void>;
}

const clamp = (n: number, floor: number, ceil: number): number =>
  Math.min(ceil, Math.max(floor, n));

const counterKey = (eventId: string): string => `event:${eventId}:counter`;
const boundsKey = (eventId: string): string => `event:${eventId}:bounds`;

/**
 * In-process counter store. Atomic by virtue of the single-threaded event loop — the read-modify-write
 * in {@link applyDelta} cannot be interleaved. Used by unit tests and the load harness so neither
 * needs a live Redis, and as the reference semantics the Redis Lua script must match.
 */
export function createMemoryCounterStore(): CounterStore {
  const values = new Map<string, number>();
  const bounds = new Map<string, { floor: number; ceil: number }>();

  return {
    async init(cfg) {
      bounds.set(cfg.eventId, { floor: cfg.floor, ceil: cfg.ceil });
      values.set(cfg.eventId, clamp(cfg.initial, cfg.floor, cfg.ceil));
    },
    async get(eventId) {
      return values.get(eventId) ?? 0;
    },
    async applyDelta(eventId, delta) {
      const b = bounds.get(eventId);
      if (!b) throw new Error(`counter not initialised for event ${eventId}`);
      const next = clamp((values.get(eventId) ?? 0) + delta, b.floor, b.ceil);
      values.set(eventId, next);
      return next;
    },
    async reset(eventId) {
      values.delete(eventId);
      bounds.delete(eventId);
    },
    async close() {
      values.clear();
      bounds.clear();
    },
  };
}

/**
 * The exact clamp-and-add semantics of {@link createMemoryCounterStore.applyDelta}, run server-side
 * inside Redis as a single atomic script. Keeping it as a named constant lets the counter test assert
 * the two implementations agree. Returns the new value as a string (Lua numbers are doubles; we parse
 * back to a JS number).
 */
export const APPLY_DELTA_LUA = `
local cur = tonumber(redis.call('GET', KEYS[1]))
if cur == nil then cur = tonumber(ARGV[2]) end
local floor = tonumber(ARGV[3])
local ceil = tonumber(ARGV[4])
local next = cur + tonumber(ARGV[1])
if next < floor then next = floor end
if next > ceil then next = ceil end
redis.call('SET', KEYS[1], next)
return tostring(next)
`;

/**
 * Redis-backed store — the production authoritative counter. `applyDelta` runs {@link APPLY_DELTA_LUA}
 * so the read-modify-write is atomic across every stateless WS node (P1-S-6). Bounds are stashed in a
 * side hash so the script self-heals if the counter key was evicted.
 */
export function createRedisCounterStore(redis: Redis): CounterStore {
  return {
    async init(cfg) {
      await redis
        .multi()
        .hset(boundsKey(cfg.eventId), 'floor', cfg.floor, 'ceil', cfg.ceil)
        .set(counterKey(cfg.eventId), clamp(cfg.initial, cfg.floor, cfg.ceil))
        .exec();
    },
    async get(eventId) {
      const raw = await redis.get(counterKey(eventId));
      return raw === null ? 0 : Number(raw);
    },
    async applyDelta(eventId, delta) {
      const b = await redis.hgetall(boundsKey(eventId));
      if (b.floor === undefined || b.ceil === undefined) {
        throw new Error(`counter not initialised for event ${eventId}`);
      }
      const next = (await redis.eval(
        APPLY_DELTA_LUA,
        1,
        counterKey(eventId),
        String(delta),
        '0',
        b.floor,
        b.ceil,
      )) as string;
      return Number(next);
    },
    async reset(eventId) {
      await redis.del(counterKey(eventId), boundsKey(eventId));
    },
    async close() {
      await redis.quit();
    },
  };
}
