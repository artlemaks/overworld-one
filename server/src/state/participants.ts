import type Redis from 'ioredis';

/**
 * Per-player contribution tracking (P2-D-1 / OOM-39).
 *
 * The authoritative counter (`CounterStore`) is a single shared number and says nothing about *who*
 * moved it. This store is the per-player ledger the resolution flow (P2-S-4) tallies into tiers and
 * rewards, and the running combo state the XP engine (P2-S-3) scales from. It lives in the Redis hash
 * `contribution:{eventId}:{playerId}` (the exact key the task names).
 *
 * Follows the same seam-with-in-memory-twin shape as {@link CounterStore} (indication
 * `seam-with-in-memory-twin`): a memory twin is the reference semantics used by every unit test and the
 * load harness, and the Redis impl must match it. A single player's record is only ever mutated by the
 * one WS node that player is connected to (client identity is the socket), so the read-modify-write is
 * race-free per player without cross-node coordination — no Lua needed here.
 */

/** The durable per-player state accumulated across an event. */
export interface ParticipantRecord {
  playerId: string;
  /** Sum of server-authoritative points this player contributed. */
  contributionTotal: number;
  /** Number of accepted contributions. */
  contributionCount: number;
  /** Event XP earned (already combo-scaled + capped, P2-S-3). */
  xpEarned: number;
  /** Current combo streak length (server-derived, never client-asserted). */
  comboStreak: number;
  /** Epoch ms of the first contribution (for participation duration). */
  firstTs: number;
  /** Epoch ms of the most recent contribution. */
  lastTs: number;
}

/** One accepted contribution's already-computed effect on a participant record. */
export interface ParticipantDelta {
  /** Authoritative points applied. */
  points: number;
  /** XP to add (computed by the XP engine from `streak`). */
  xp: number;
  /** The combo streak length *after* this contribution. */
  streak: number;
  /** Epoch ms of this contribution. */
  ts: number;
}

export interface ParticipantStore {
  /** Fold one contribution into a player's record, returning the updated record. */
  record(eventId: string, playerId: string, delta: ParticipantDelta): Promise<ParticipantRecord>;
  /** A single player's record, or null if they never contributed. */
  get(eventId: string, playerId: string): Promise<ParticipantRecord | null>;
  /** Every participant's record for an event — the resolution flow tallies over this. */
  list(eventId: string): Promise<ParticipantRecord[]>;
  /** Drop all per-player state for an event. */
  reset(eventId: string): Promise<void>;
  /** Release any underlying connection. */
  close(): Promise<void>;
}

/** Apply a delta to an existing (or empty) record — the shared reference semantics for both impls. */
function fold(
  prev: ParticipantRecord | null,
  playerId: string,
  delta: ParticipantDelta,
): ParticipantRecord {
  if (!prev) {
    return {
      playerId,
      contributionTotal: delta.points,
      contributionCount: 1,
      xpEarned: delta.xp,
      comboStreak: delta.streak,
      firstTs: delta.ts,
      lastTs: delta.ts,
    };
  }
  return {
    playerId,
    contributionTotal: prev.contributionTotal + delta.points,
    contributionCount: prev.contributionCount + 1,
    xpEarned: prev.xpEarned + delta.xp,
    comboStreak: delta.streak,
    firstTs: Math.min(prev.firstTs, delta.ts),
    lastTs: Math.max(prev.lastTs, delta.ts),
  };
}

/** In-process participant store — reference semantics for tests + the load harness. */
export function createMemoryParticipantStore(): ParticipantStore {
  // eventId -> playerId -> record
  const byEvent = new Map<string, Map<string, ParticipantRecord>>();

  const eventMap = (eventId: string): Map<string, ParticipantRecord> => {
    let m = byEvent.get(eventId);
    if (!m) {
      m = new Map();
      byEvent.set(eventId, m);
    }
    return m;
  };

  return {
    async record(eventId, playerId, delta) {
      const m = eventMap(eventId);
      const next = fold(m.get(playerId) ?? null, playerId, delta);
      m.set(playerId, next);
      return next;
    },
    async get(eventId, playerId) {
      return byEvent.get(eventId)?.get(playerId) ?? null;
    },
    async list(eventId) {
      return [...(byEvent.get(eventId)?.values() ?? [])];
    },
    async reset(eventId) {
      byEvent.delete(eventId);
    },
    async close() {
      byEvent.clear();
    },
  };
}

const hashKey = (eventId: string, playerId: string): string =>
  `contribution:${eventId}:${playerId}`;
const indexKey = (eventId: string): string => `contribution:${eventId}:players`;

function parseRecord(playerId: string, h: Record<string, string>): ParticipantRecord {
  return {
    playerId,
    contributionTotal: Number(h.total ?? 0),
    contributionCount: Number(h.count ?? 0),
    xpEarned: Number(h.xp ?? 0),
    comboStreak: Number(h.streak ?? 0),
    firstTs: Number(h.firstTs ?? 0),
    lastTs: Number(h.lastTs ?? 0),
  };
}

/**
 * Redis-backed participant store. Aggregate fields use atomic HINCRBY/HINCRBYFLOAT; `streak`/`lastTs`
 * are overwritten and `firstTs` is set-once (HSETNX). A per-event set indexes the player ids so
 * {@link list} can tally them at resolution without a keyspace scan.
 */
export function createRedisParticipantStore(redis: Redis): ParticipantStore {
  return {
    async record(eventId, playerId, delta) {
      const key = hashKey(eventId, playerId);
      const results = await redis
        .multi()
        .sadd(indexKey(eventId), playerId)
        .hincrbyfloat(key, 'total', delta.points)
        .hincrby(key, 'count', 1)
        .hincrbyfloat(key, 'xp', delta.xp)
        .hset(key, 'streak', delta.streak, 'lastTs', delta.ts)
        .hsetnx(key, 'firstTs', delta.ts)
        .hgetall(key)
        .exec();
      const hash = (results?.[results.length - 1]?.[1] ?? {}) as Record<string, string>;
      return parseRecord(playerId, hash);
    },
    async get(eventId, playerId) {
      const h = await redis.hgetall(hashKey(eventId, playerId));
      if (Object.keys(h).length === 0) return null;
      return parseRecord(playerId, h);
    },
    async list(eventId) {
      const ids = await redis.smembers(indexKey(eventId));
      const records: ParticipantRecord[] = [];
      for (const id of ids) {
        const h = await redis.hgetall(hashKey(eventId, id));
        if (Object.keys(h).length > 0) records.push(parseRecord(id, h));
      }
      return records;
    },
    async reset(eventId) {
      const ids = await redis.smembers(indexKey(eventId));
      const keys = ids.map((id) => hashKey(eventId, id));
      await redis.del(indexKey(eventId), ...keys);
    },
    async close() {
      await redis.quit();
    },
  };
}
