-- P2-D-2 / OOM-41 — Full-event-loop durable schema.
--
-- Redis holds live authoritative state; these tables are the durable record that survives a Redis
-- restart (checkpoints + replay log, P2-D-3 / P2-X-1) and the query surface later phases read from
-- (profile, pass, live-ops). Shapes match the persistence seam in src/state/persistence.ts.
--
-- Timestamps are stored as epoch-ms BIGINT (the same clock the wire protocol uses) rather than
-- TIMESTAMPTZ, so a snapshot round-trips through Redis, JSON, and Postgres without timezone drift.

CREATE TABLE IF NOT EXISTS players (
  player_id     TEXT PRIMARY KEY,
  created_at_ts BIGINT NOT NULL,
  total_xp      BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  event_id       TEXT PRIMARY KEY,
  status         TEXT NOT NULL,          -- LifecycleStatus: pending|active|resolving|resolved|failed
  outcome        TEXT,                   -- EventOutcome: completed|failed (NULL while live)
  hp_max         DOUBLE PRECISION NOT NULL,
  direction      TEXT NOT NULL,          -- 'down' (boss) | 'up' (structure)
  started_at_ts  BIGINT NOT NULL,
  resolved_at_ts BIGINT
);

CREATE TABLE IF NOT EXISTS event_participants (
  event_id                  TEXT NOT NULL REFERENCES events(event_id),
  player_id                 TEXT NOT NULL,
  contribution_total        DOUBLE PRECISION NOT NULL,
  tier                      TEXT NOT NULL,   -- none|bronze|silver|gold|legendary
  xp_earned                 BIGINT NOT NULL,
  participation_duration_ms BIGINT NOT NULL,
  last_update_ts            BIGINT NOT NULL,
  PRIMARY KEY (event_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_event_participants_player ON event_participants (player_id);

CREATE TABLE IF NOT EXISTS player_commemoratives (
  commemorative_id TEXT PRIMARY KEY,
  player_id        TEXT NOT NULL,
  event_id         TEXT NOT NULL REFERENCES events(event_id),
  rarity           TEXT NOT NULL,       -- common|rare|epic|legendary
  earned_at_ts     BIGINT NOT NULL,
  expires_at_ts    BIGINT               -- NULL = permanent; set = FOMO expiry
);
CREATE INDEX IF NOT EXISTS idx_commemoratives_player ON player_commemoratives (player_id);
CREATE INDEX IF NOT EXISTS idx_commemoratives_expiry ON player_commemoratives (expires_at_ts);

-- Durable checkpoints — highest seq wins on recovery (P2-D-3).
CREATE TABLE IF NOT EXISTS event_checkpoints (
  event_id     TEXT NOT NULL,
  seq          INTEGER NOT NULL,
  state        JSONB NOT NULL,          -- serialized EventState
  taken_at_ts  BIGINT NOT NULL,
  PRIMARY KEY (event_id, seq)
);

-- Append-only replay log covering the short post-checkpoint window (P2-D-3).
CREATE TABLE IF NOT EXISTS event_replay_log (
  id            BIGSERIAL PRIMARY KEY,
  event_id      TEXT NOT NULL,
  ts            BIGINT NOT NULL,
  contrib_delta DOUBLE PRECISION NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_replay_event_ts ON event_replay_log (event_id, ts);
