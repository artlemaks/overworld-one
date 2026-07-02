import type { Account, SessionToken } from '@overworld/shared';

/**
 * Anonymous device account service (P4-S-1 / OOM).
 *
 * Zero-friction identity, server side: a player is a device token first. `registerDevice` mints a fresh
 * anonymous {@link Account} (kind `anonymous`, `email` null) plus a bound {@link SessionToken}; every
 * subsequent WS + HTTP call authenticates by presenting that token. `verifySession` is the guard the
 * transport calls on each request (existence + expiry against the injected clock); `issueSession`
 * re-mints a token (e.g. on reconnect or after an email upgrade, P4-S-2, where the `playerId` is stable);
 * `touch` records liveness for presence/idle reaping.
 *
 * Pure of wall-clock and I/O: the caller injects `now`, `genId`, and `genToken`, so the logic is fully
 * unit-testable in Node. Storage is an in-process {@link Map} — the Redis/Postgres-backed persistence
 * (durable accounts + session revocation across nodes) is future work and slots behind this same
 * interface without changing callers.
 */

export interface AccountServiceOptions {
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Injectable player-id source (opaque, unique). */
  genId: () => string;
  /** Injectable session-token source (opaque, unguessable). */
  genToken: () => string;
  /** How long an issued session stays valid, in ms. */
  sessionTtlMs: number;
}

/** The result of verifying a presented session token. */
export interface SessionVerification {
  valid: boolean;
  /** The bound player, present when `valid`. */
  playerId?: string;
  /** Why verification failed (`unknown` | `expired`), present when not `valid`. */
  reason?: string;
}

export interface AccountService {
  /** Mint a fresh anonymous account + its first session. */
  registerDevice(): { account: Account; session: SessionToken };
  /** Issue (or re-issue) a session bound to an existing player. Throws if the player is unknown. */
  issueSession(playerId: string): SessionToken;
  /** Check a presented token: exists and not past its `expiresAtTs` against `now`. */
  verifySession(token: string): SessionVerification;
  /** Record that a player was just seen (presence/idle reaping). No-op if unknown. */
  touch(playerId: string): void;
  /** Fetch an account by id, or null if unknown. */
  getAccount(playerId: string): Account | null;
}

export function createAccountService(opts: AccountServiceOptions): AccountService {
  const accounts = new Map<string, Account>();
  const sessions = new Map<string, SessionToken>();

  const issueSession = (playerId: string): SessionToken => {
    if (!accounts.has(playerId)) {
      throw new Error(`cannot issue session for unknown player: ${playerId}`);
    }
    const issuedAtTs = opts.now();
    const session: SessionToken = {
      token: opts.genToken(),
      playerId,
      issuedAtTs,
      expiresAtTs: issuedAtTs + opts.sessionTtlMs,
    };
    sessions.set(session.token, session);
    return session;
  };

  return {
    registerDevice() {
      const createdAtTs = opts.now();
      const playerId = opts.genId();
      const account: Account = {
        playerId,
        kind: 'anonymous',
        email: null,
        createdAtTs,
        lastSeenTs: createdAtTs,
      };
      accounts.set(playerId, account);
      const session = issueSession(playerId);
      return { account, session };
    },
    issueSession,
    verifySession(token) {
      const session = sessions.get(token);
      if (!session) return { valid: false, reason: 'unknown' };
      if (opts.now() >= session.expiresAtTs) return { valid: false, reason: 'expired' };
      return { valid: true, playerId: session.playerId };
    },
    touch(playerId) {
      const account = accounts.get(playerId);
      if (!account) return;
      accounts.set(playerId, { ...account, lastSeenTs: opts.now() });
    },
    getAccount(playerId) {
      return accounts.get(playerId) ?? null;
    },
  };
}
