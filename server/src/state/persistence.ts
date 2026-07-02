import type { Pool } from 'pg';
import {
  type EventSnapshot,
  type ReplayLogEntry,
  type Commemorative,
  type LifecycleStatus,
  type EventOutcome,
  type Tier,
} from '@overworld/shared';

/** Counter direction, kept as a literal here so the state layer need not import the game layer. */
export type CounterDirection = 'down' | 'up';

/**
 * Durable persistence seam (P2-D-2 / OOM-41).
 *
 * Redis is the hot authoritative store; Postgres is the durable record that survives a Redis restart
 * and the query surface later phases (profile, pass, live-ops) read from. This module is the seam
 * between the game and that database, following the same in-memory-twin pattern as `CounterStore`
 * (indication `seam-with-in-memory-twin`): the memory twin is the reference semantics every test and
 * the integration/recovery suites run against, and {@link createPostgresPersistence} must match it.
 *
 * It backs four durable concerns:
 *  - **events** — one row per event with its lifecycle status + outcome (P2-S-1 / P2-S-4);
 *  - **checkpoints / replay log** — the durable snapshot + short replay window (P2-D-3 / P2-X-1);
 *  - **event_participants** — final per-player tallies, tiers, and XP written at resolution (P2-S-4);
 *  - **player_commemoratives** — granted badges with FOMO expiry (P2-P-1).
 *
 * The table shapes are the ones the task names; the SQL DDL lives in
 * `server/migrations/001_p2_event_loop.sql`.
 */

/** One event's durable header row. */
export interface EventRecord {
  eventId: string;
  status: LifecycleStatus;
  /** Set once terminal; null while the event is still live. */
  outcome: EventOutcome | null;
  hpMax: number;
  direction: CounterDirection;
  startedAtTs: number;
  resolvedAtTs: number | null;
}

/** A final per-player tally row (the `event_participants` table). */
export interface ParticipantResultRow {
  eventId: string;
  playerId: string;
  contributionTotal: number;
  tier: Tier;
  xpEarned: number;
  participationDurationMs: number;
  lastUpdateTs: number;
}

export interface PersistenceStore {
  /** Insert or update an event header row. */
  upsertEvent(rec: EventRecord): Promise<void>;
  getEvent(eventId: string): Promise<EventRecord | null>;

  /** Append a durable checkpoint (idempotent on `(eventId, seq)` — higher seq wins on recovery). */
  writeCheckpoint(snapshot: EventSnapshot): Promise<void>;
  /** The highest-seq checkpoint for an event, or null if none written yet. */
  latestCheckpoint(eventId: string): Promise<EventSnapshot | null>;

  /** Append one replay-log entry. */
  appendReplay(entry: ReplayLogEntry): Promise<void>;
  /** Replay entries strictly after `sinceTs`, in ts order — the post-checkpoint window. */
  replaySince(eventId: string, sinceTs: number): Promise<ReplayLogEntry[]>;

  /** Write final per-player tallies (called once at resolution; idempotent per player). */
  saveParticipants(rows: ParticipantResultRow[]): Promise<void>;
  listParticipants(eventId: string): Promise<ParticipantResultRow[]>;

  /** Grant a commemorative to a player. */
  grantCommemorative(playerId: string, commemorative: Commemorative): Promise<void>;
  listCommemoratives(playerId: string): Promise<Commemorative[]>;

  close(): Promise<void>;
}

/** In-process persistence — reference semantics for tests, the integration suite, and the harness. */
export function createMemoryPersistence(): PersistenceStore {
  const events = new Map<string, EventRecord>();
  const checkpoints = new Map<string, EventSnapshot[]>(); // eventId -> snapshots
  const replay = new Map<string, ReplayLogEntry[]>(); // eventId -> entries
  const participants = new Map<string, Map<string, ParticipantResultRow>>();
  const commemoratives = new Map<string, Commemorative[]>(); // playerId -> badges

  return {
    async upsertEvent(rec) {
      events.set(rec.eventId, { ...rec });
    },
    async getEvent(eventId) {
      const e = events.get(eventId);
      return e ? { ...e } : null;
    },
    async writeCheckpoint(snapshot) {
      const list = checkpoints.get(snapshot.eventId) ?? [];
      // Idempotent on seq: replace any existing snapshot with the same seq.
      const filtered = list.filter((s) => s.seq !== snapshot.seq);
      filtered.push({ ...snapshot });
      checkpoints.set(snapshot.eventId, filtered);
    },
    async latestCheckpoint(eventId) {
      const list = checkpoints.get(eventId);
      if (!list || list.length === 0) return null;
      return list.reduce((best, s) => (s.seq > best.seq ? s : best));
    },
    async appendReplay(entry) {
      const list = replay.get(entry.eventId) ?? [];
      list.push({ ...entry });
      replay.set(entry.eventId, list);
    },
    async replaySince(eventId, sinceTs) {
      return (replay.get(eventId) ?? [])
        .filter((e) => e.ts > sinceTs)
        .sort((a, b) => a.ts - b.ts)
        .map((e) => ({ ...e }));
    },
    async saveParticipants(rows) {
      for (const row of rows) {
        let m = participants.get(row.eventId);
        if (!m) {
          m = new Map();
          participants.set(row.eventId, m);
        }
        m.set(row.playerId, { ...row });
      }
    },
    async listParticipants(eventId) {
      return [...(participants.get(eventId)?.values() ?? [])].map((r) => ({ ...r }));
    },
    async grantCommemorative(playerId, commemorative) {
      const list = commemoratives.get(playerId) ?? [];
      list.push({ ...commemorative });
      commemoratives.set(playerId, list);
    },
    async listCommemoratives(playerId) {
      return (commemoratives.get(playerId) ?? []).map((c) => ({ ...c }));
    },
    async close() {
      events.clear();
      checkpoints.clear();
      replay.clear();
      participants.clear();
      commemoratives.clear();
    },
  };
}

/**
 * Postgres-backed persistence — the production durable store. Thin translation of the seam to SQL
 * against the schema in `migrations/001_p2_event_loop.sql`. Like the Redis counter impl, it is wired
 * in `index.ts` and smoke-exercised against a live database rather than in CI (which has no Postgres).
 */
export function createPostgresPersistence(pool: Pool): PersistenceStore {
  return {
    async upsertEvent(rec) {
      await pool.query(
        `INSERT INTO events (event_id, status, outcome, hp_max, direction, started_at_ts, resolved_at_ts)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (event_id) DO UPDATE SET
           status = EXCLUDED.status, outcome = EXCLUDED.outcome,
           resolved_at_ts = EXCLUDED.resolved_at_ts`,
        [rec.eventId, rec.status, rec.outcome, rec.hpMax, rec.direction, rec.startedAtTs, rec.resolvedAtTs],
      );
    },
    async getEvent(eventId) {
      const { rows } = await pool.query(`SELECT * FROM events WHERE event_id = $1`, [eventId]);
      const r = rows[0];
      if (!r) return null;
      return {
        eventId: r.event_id,
        status: r.status,
        outcome: r.outcome,
        hpMax: Number(r.hp_max),
        direction: r.direction,
        startedAtTs: Number(r.started_at_ts),
        resolvedAtTs: r.resolved_at_ts === null ? null : Number(r.resolved_at_ts),
      };
    },
    async writeCheckpoint(snapshot) {
      await pool.query(
        `INSERT INTO event_checkpoints (event_id, seq, state, taken_at_ts)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (event_id, seq) DO UPDATE SET state = EXCLUDED.state, taken_at_ts = EXCLUDED.taken_at_ts`,
        [snapshot.eventId, snapshot.seq, JSON.stringify(snapshot.state), snapshot.takenAtTs],
      );
    },
    async latestCheckpoint(eventId) {
      const { rows } = await pool.query(
        `SELECT * FROM event_checkpoints WHERE event_id = $1 ORDER BY seq DESC LIMIT 1`,
        [eventId],
      );
      const r = rows[0];
      if (!r) return null;
      return {
        eventId: r.event_id,
        seq: Number(r.seq),
        state: typeof r.state === 'string' ? JSON.parse(r.state) : r.state,
        takenAtTs: Number(r.taken_at_ts),
      };
    },
    async appendReplay(entry) {
      await pool.query(
        `INSERT INTO event_replay_log (event_id, ts, contrib_delta) VALUES ($1,$2,$3)`,
        [entry.eventId, entry.ts, entry.contribDelta],
      );
    },
    async replaySince(eventId, sinceTs) {
      const { rows } = await pool.query(
        `SELECT event_id, ts, contrib_delta FROM event_replay_log
         WHERE event_id = $1 AND ts > $2 ORDER BY ts ASC`,
        [eventId, sinceTs],
      );
      return rows.map((r) => ({
        eventId: r.event_id,
        ts: Number(r.ts),
        contribDelta: Number(r.contrib_delta),
      }));
    },
    async saveParticipants(rows) {
      for (const row of rows) {
        await pool.query(
          `INSERT INTO event_participants
             (event_id, player_id, contribution_total, tier, xp_earned, participation_duration_ms, last_update_ts)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (event_id, player_id) DO UPDATE SET
             contribution_total = EXCLUDED.contribution_total, tier = EXCLUDED.tier,
             xp_earned = EXCLUDED.xp_earned,
             participation_duration_ms = EXCLUDED.participation_duration_ms,
             last_update_ts = EXCLUDED.last_update_ts`,
          [row.eventId, row.playerId, row.contributionTotal, row.tier, row.xpEarned, row.participationDurationMs, row.lastUpdateTs],
        );
      }
    },
    async listParticipants(eventId) {
      const { rows } = await pool.query(
        `SELECT * FROM event_participants WHERE event_id = $1`,
        [eventId],
      );
      return rows.map((r) => ({
        eventId: r.event_id,
        playerId: r.player_id,
        contributionTotal: Number(r.contribution_total),
        tier: r.tier,
        xpEarned: Number(r.xp_earned),
        participationDurationMs: Number(r.participation_duration_ms),
        lastUpdateTs: Number(r.last_update_ts),
      }));
    },
    async grantCommemorative(playerId, c) {
      await pool.query(
        `INSERT INTO player_commemoratives
           (commemorative_id, player_id, event_id, rarity, earned_at_ts, expires_at_ts)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (commemorative_id) DO NOTHING`,
        [c.commemorativeId, playerId, c.eventId, c.rarity, c.earnedAtTs, c.expiresAtTs],
      );
    },
    async listCommemoratives(playerId) {
      const { rows } = await pool.query(
        `SELECT * FROM player_commemoratives WHERE player_id = $1 ORDER BY earned_at_ts DESC`,
        [playerId],
      );
      return rows.map((r) => ({
        commemorativeId: r.commemorative_id,
        eventId: r.event_id,
        rarity: r.rarity,
        earnedAtTs: Number(r.earned_at_ts),
        expiresAtTs: r.expires_at_ts === null ? null : Number(r.expires_at_ts),
      }));
    },
    async close() {
      await pool.end();
    },
  };
}
