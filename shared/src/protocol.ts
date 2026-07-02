import { z } from 'zod';
import { ContributionMessage, TickSnapshot } from './contracts.js';

/**
 * WebSocket wire protocol (P1 / OOM-25, OOM-32).
 *
 * `contracts.ts` defines the domain payloads (a contribution, a tick snapshot). This module wraps
 * them in the small, versioned **envelope** that actually travels over the socket: a discriminated
 * union with a `type` tag on every frame, so both ends decode with a single `parse` and can never
 * disagree about the shape of a message (indication `contracts-single-source-of-truth`).
 *
 * Kept deliberately tiny — the constant-bandwidth guarantee (P1 DoD) depends on the server→client
 * stream being dominated by fixed-size {@link TickSnapshot}s, not by chatty per-message overhead.
 */

/** Monotonic per-client sequence number, letting the client reconcile its local prediction. */
export const Seq = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

/** First frame after connect: claims the anonymous identity issued on the landing screen. */
export const JoinMessage = z.object({
  type: z.literal('join'),
  playerId: z.string().min(1),
});

/** A contribution, tagged with a client `seq` so the matching {@link ContribAck} can reconcile it. */
export const ContributionFrame = z.object({
  type: z.literal('contribution'),
  seq: Seq,
  contribution: ContributionMessage,
});

/** Heartbeat reply — echoes the server ping timestamp so the server can measure RTT. */
export const PongMessage = z.object({
  type: z.literal('pong'),
  ts: z.number().int().nonnegative(),
});

export const ClientMessage = z.discriminatedUnion('type', [
  JoinMessage,
  ContributionFrame,
  PongMessage,
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

/**
 * Sent once, right after a valid {@link JoinMessage}. Carries the few constants the client needs to
 * render — notably `bossHpMax`, so the client no longer hardcodes it and cannot drift from the
 * server's authoritative maximum.
 */
export const WelcomeMessage = z.object({
  type: z.literal('welcome'),
  playerId: z.string().min(1),
  bossHpMax: z.number().positive(),
  tickHz: z.number().positive(),
  serverTs: z.number().int().nonnegative(),
});

/** The authoritative per-tick snapshot — the dominant, fixed-size frame on the stream. */
export const TickFrame = z.object({
  type: z.literal('tick'),
  snapshot: TickSnapshot,
});

/**
 * The server's authoritative answer to one contribution: the point value **it** computed (P1-S-3),
 * echoed against the client `seq` so the client can replace its provisional local score. `accepted`
 * is false when the contribution was rate-limited or rejected by anti-cheat; `reason` says why.
 */
export const ContribAck = z.object({
  type: z.literal('contribAck'),
  seq: Seq,
  accepted: z.boolean(),
  /** Authoritative points applied (0 when not accepted). */
  points: z.number().nonnegative(),
  reason: z.string().optional(),
});

/** Heartbeat probe — the client replies with a {@link PongMessage} echoing `ts`. */
export const PingMessage = z.object({
  type: z.literal('ping'),
  ts: z.number().int().nonnegative(),
});

/** A protocol-level error (bad frame, unknown identity, etc.). */
export const ErrorMessage = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
});

export const ServerMessage = z.discriminatedUnion('type', [
  WelcomeMessage,
  TickFrame,
  ContribAck,
  PingMessage,
  ErrorMessage,
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/** Encode any server or client message to a wire string. */
export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

/** Decode + validate a client frame; throws (via Zod) on anything off-contract. */
export function decodeClientMessage(raw: string): ClientMessage {
  return ClientMessage.parse(JSON.parse(raw));
}

/** Decode + validate a server frame; throws (via Zod) on anything off-contract. */
export function decodeServerMessage(raw: string): ServerMessage {
  return ServerMessage.parse(JSON.parse(raw));
}
