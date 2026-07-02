import {
  decodeServerMessage,
  encode,
  type ContributionMessage,
  type EventState,
  type TickSnapshot,
} from '@overworld/shared';

/**
 * Client netcode (P1-C-1 / OOM-32).
 *
 * Replaces the P0 local mock/scoring with the authoritative server stream. Three concerns, all kept
 * pure and transport-injected so they are unit-testable in Node (no real WebSocket, no DOM):
 *
 *  1. **Connection lifecycle** — connect, and on drop reconnect with exponential backoff
 *     ({@link computeBackoffMs}); re-`join` automatically on every (re)open.
 *  2. **Interpolation** — buffer recent {@link TickSnapshot}s and render slightly *behind* real time
 *     ({@link interpolateSnapshots}) so the shared bar animates smoothly between 3–5 Hz ticks instead
 *     of stepping.
 *  3. **Prediction reconciliation** — show the player's score instantly on strike (optimistic), then
 *     reconcile to the server's authoritative points when the matching `contribAck` returns. The
 *     shared bar itself is never predicted (it's a many-player aggregate); only the *personal* score
 *     is, exactly the P0 local score this replaces.
 */

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export interface BackoffConfig {
  baseMs: number;
  factor: number;
  maxMs: number;
}

export const DEFAULT_BACKOFF: BackoffConfig = { baseMs: 500, factor: 2, maxMs: 10_000 };

/** Exponential backoff for reconnect attempt `n` (0-based), capped at `maxMs`. */
export function computeBackoffMs(attempt: number, cfg: BackoffConfig = DEFAULT_BACKOFF): number {
  const raw = cfg.baseMs * Math.pow(cfg.factor, Math.max(0, attempt));
  return Math.min(cfg.maxMs, raw);
}

/** A snapshot tagged with the local time it arrived — the timeline used for interpolation. */
export interface BufferedSnapshot {
  snapshot: TickSnapshot;
  arrivalTs: number;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Interpolate the authoritative state at `renderTargetTs` (local clock) from a buffer of arrivals.
 * Continuous fields (`bossHp`, `phaseProgressPct`) are lerped between the two bracketing snapshots;
 * discrete fields (`phase`, counts) take the later snapshot of the pair so a phase change is never
 * shown late. Interpolating on *arrival* time (not `serverTs`) keeps it robust to client/server clock
 * skew. Returns `null` for an empty buffer.
 */
export function interpolateSnapshots(
  buffer: BufferedSnapshot[],
  renderTargetTs: number,
): EventState | null {
  const first = buffer[0];
  const newest = buffer[buffer.length - 1];
  if (!first || !newest) return null;
  if (buffer.length === 1 || renderTargetTs <= first.arrivalTs) return first.snapshot.eventState;
  if (renderTargetTs >= newest.arrivalTs) return newest.snapshot.eventState;

  let lo = first;
  let hi = newest;
  for (let i = 1; i < buffer.length; i++) {
    const cur = buffer[i];
    const prev = buffer[i - 1];
    if (cur && prev && cur.arrivalTs >= renderTargetTs) {
      hi = cur;
      lo = prev;
      break;
    }
  }
  const span = hi.arrivalTs - lo.arrivalTs;
  const t = span > 0 ? (renderTargetTs - lo.arrivalTs) / span : 1;
  const a = lo.snapshot.eventState;
  const b = hi.snapshot.eventState;
  return {
    bossHp: lerp(a.bossHp, b.bossHp, t),
    phase: b.phase,
    phaseProgressPct: lerp(a.phaseProgressPct, b.phaseProgressPct, t),
    contribWaveCount: b.contribWaveCount,
    playersContributingNow: b.playersContributingNow,
  };
}

// ---------------------------------------------------------------------------
// Transport seam
// ---------------------------------------------------------------------------

export interface NetSocket {
  send(data: string): void;
  close(): void;
}

export interface NetSocketHandlers {
  onOpen(): void;
  onMessage(raw: string): void;
  onClose(): void;
}

/** Opens a socket to `url`, wiring the handlers. Real impl in `wsSocket.ts`; tests pass a fake. */
export type SocketFactory = (url: string, handlers: NetSocketHandlers) => NetSocket;

export type ConnStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface NetClientOptions {
  url: string;
  playerId: string;
  connect: SocketFactory;
  now?: () => number;
  /** Schedules reconnect attempts; injectable for deterministic tests. Defaults to `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => void;
  backoff?: BackoffConfig;
  /** How far behind real time to render, smoothing between ticks. Defaults to 250ms. */
  interpolationDelayMs?: number;
  /** Cap on buffered snapshots. */
  bufferSize?: number;
}

export interface NetClient {
  start(): void;
  stop(): void;
  status(): ConnStatus;
  /** Send a contribution; returns its seq. `predictedPoints` shows instantly, reconciled on ack. */
  sendContribution(contribution: ContributionMessage, predictedPoints: number): number;
  /** Newest authoritative state, or null before the first tick. */
  latestState(): EventState | null;
  /** Interpolated state for rendering at the given local clock. */
  renderState(renderNowTs: number): EventState | null;
  /** Authoritative boss HP max from `welcome`, or null before joining. */
  bossHpMax(): number | null;
  /** Personal score: reconciled authoritative total plus not-yet-acked optimistic predictions. */
  displayScore(): number;
}

export function createNetClient(opts: NetClientOptions): NetClient {
  const now = opts.now ?? (() => Date.now());
  const schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const backoff = opts.backoff ?? DEFAULT_BACKOFF;
  const interpolationDelayMs = opts.interpolationDelayMs ?? 250;
  const bufferSize = opts.bufferSize ?? 16;

  let socket: NetSocket | null = null;
  let status: ConnStatus = 'idle';
  let attempt = 0;
  let stopped = false;

  const buffer: BufferedSnapshot[] = [];
  let bossHpMax: number | null = null;
  let nextSeq = 0;
  let authoritativeScore = 0;
  let pendingPredicted = 0;
  const pending = new Map<number, number>(); // seq -> predicted points

  const open = (): void => {
    status = attempt === 0 ? 'connecting' : 'reconnecting';
    socket = opts.connect(opts.url, {
      onOpen() {
        status = 'open';
        attempt = 0;
        socket?.send(encode({ type: 'join', playerId: opts.playerId }));
      },
      onMessage(raw) {
        handleMessage(raw);
      },
      onClose() {
        socket = null;
        if (stopped) {
          status = 'closed';
          return;
        }
        status = 'reconnecting';
        const delay = computeBackoffMs(attempt, backoff);
        attempt += 1;
        schedule(() => {
          if (!stopped) open();
        }, delay);
      },
    });
  };

  const handleMessage = (raw: string): void => {
    let msg;
    try {
      msg = decodeServerMessage(raw);
    } catch {
      return; // ignore off-contract frames
    }
    switch (msg.type) {
      case 'welcome':
        bossHpMax = msg.bossHpMax;
        return;
      case 'tick':
        buffer.push({ snapshot: msg.snapshot, arrivalTs: now() });
        while (buffer.length > bufferSize) buffer.shift();
        return;
      case 'contribAck': {
        const predicted = pending.get(msg.seq);
        if (predicted !== undefined) {
          pending.delete(msg.seq);
          pendingPredicted -= predicted;
        }
        if (msg.accepted) authoritativeScore += msg.points;
        return;
      }
      case 'ping':
        socket?.send(encode({ type: 'pong', ts: msg.ts }));
        return;
      case 'error':
        return;
    }
  };

  return {
    start() {
      stopped = false;
      attempt = 0;
      open();
    },
    stop() {
      stopped = true;
      status = 'closed';
      socket?.close();
      socket = null;
    },
    status() {
      return status;
    },
    sendContribution(contribution, predictedPoints) {
      const seq = nextSeq++;
      pending.set(seq, predictedPoints);
      pendingPredicted += predictedPoints;
      socket?.send(encode({ type: 'contribution', seq, contribution }));
      return seq;
    },
    latestState() {
      const newest = buffer[buffer.length - 1];
      return newest ? newest.snapshot.eventState : null;
    },
    renderState(renderNowTs) {
      return interpolateSnapshots(buffer, renderNowTs - interpolationDelayMs);
    },
    bossHpMax() {
      return bossHpMax;
    },
    displayScore() {
      return authoritativeScore + pendingPredicted;
    },
  };
}
