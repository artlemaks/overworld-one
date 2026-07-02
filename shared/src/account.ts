import { z } from 'zod';

/**
 * Account & identity contracts (P4-S-1 anonymous device account / OOM; P4-S-2 email upgrade).
 *
 * The SINGLE SOURCE OF TRUTH for zero-friction identity: a player is an anonymous device token first,
 * and *optionally* upgrades to an email-backed account later (magic link) without losing progress. The
 * token is what authenticates every WS + HTTP call; the email is a recovery/portability layer on top,
 * never a gate to play (scope §6/§7.1 — accounts are zero-friction).
 *
 * Pure schemas; issuing/verifying tokens is server-side and dependency-injects its clock + id/secret
 * source so the logic stays unit-testable in Node.
 */

/** How an account is currently identified. `anonymous` = device token only; `email` = upgraded. */
export const AccountKind = z.enum(['anonymous', 'email']);
export type AccountKind = z.infer<typeof AccountKind>;

/** The durable player account. `playerId` is stable across an email upgrade — progress never resets. */
export const Account = z.object({
  playerId: z.string().min(1),
  kind: AccountKind,
  /** Present once upgraded (P4-S-2); null while anonymous. */
  email: z.string().email().nullable(),
  createdAtTs: z.number().int().nonnegative(),
  lastSeenTs: z.number().int().nonnegative(),
});
export type Account = z.infer<typeof Account>;

/**
 * A session token bound to a player. Issued on first connect (device account) and re-issued on email
 * upgrade. `expiresAtTs` bounds its life; the server checks it on every WS + HTTP request (session auth).
 */
export const SessionToken = z.object({
  token: z.string().min(1),
  playerId: z.string().min(1),
  issuedAtTs: z.number().int().nonnegative(),
  expiresAtTs: z.number().int().nonnegative(),
});
export type SessionToken = z.infer<typeof SessionToken>;

/**
 * A magic-link challenge for the optional email upgrade (P4-S-2). The server emails `linkId` (opaque);
 * the client posts it back to complete the upgrade. Single-use, short-lived (`expiresAtTs`).
 */
export const MagicLinkChallenge = z.object({
  linkId: z.string().min(1),
  playerId: z.string().min(1),
  email: z.string().email(),
  issuedAtTs: z.number().int().nonnegative(),
  expiresAtTs: z.number().int().nonnegative(),
  consumed: z.boolean().default(false),
});
export type MagicLinkChallenge = z.infer<typeof MagicLinkChallenge>;
