import type { MagicLinkChallenge } from '@overworld/shared';

/**
 * Optional magic-link email upgrade (P4-S-2 / OOM).
 *
 * Lets an anonymous device account (P4-S-1) *optionally* bind an email for recovery/portability, without
 * ever gating play. `beginUpgrade` issues a single-use, short-lived {@link MagicLinkChallenge} the server
 * emails; the client posts the opaque `linkId` back to `completeUpgrade`, which validates it (exists, not
 * expired, not already consumed), marks it consumed, and calls the injected `applyToAccount` to flip the
 * player's {@link Account} to kind `email`.
 *
 * **The `playerId` is STABLE across the upgrade** — the challenge carries the same player id it was begun
 * for, so all progress (XP, commemoratives, streak) is preserved; upgrading only attaches an email, it
 * never creates a new player or resets anything.
 *
 * Pure of wall-clock and I/O: the caller injects `now` and `genId`, and the account mutation is delegated
 * to `applyToAccount`, so this module is fully unit-testable in Node. Storage is an in-process
 * {@link Map} — durable challenge storage is future work behind this same interface.
 */

export interface EmailUpgradeOptions {
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Injectable link-id source (opaque, unguessable — this is the secret emailed to the user). */
  genId: () => string;
  /** How long a magic link stays valid, in ms. */
  linkTtlMs: number;
}

/** The outcome of completing an upgrade. */
export interface UpgradeResult {
  ok: boolean;
  /** Why the upgrade failed (`unknown` | `expired` | `consumed`), present when not `ok`. */
  reason?: string;
}

/** Flip the account for `playerId` to email-backed. Injected so this module owns no account storage. */
export type ApplyToAccount = (playerId: string, email: string) => void;

export interface EmailUpgradeService {
  /** Issue an unconsumed, expiring magic-link challenge for a player + email. */
  beginUpgrade(playerId: string, email: string): MagicLinkChallenge;
  /** Consume a challenge by its `linkId`, applying the email to the account. Single-use. */
  completeUpgrade(linkId: string, applyToAccount: ApplyToAccount): UpgradeResult;
}

export function createEmailUpgradeService(opts: EmailUpgradeOptions): EmailUpgradeService {
  const challenges = new Map<string, MagicLinkChallenge>();

  return {
    beginUpgrade(playerId, email) {
      const issuedAtTs = opts.now();
      const challenge: MagicLinkChallenge = {
        linkId: opts.genId(),
        playerId,
        email,
        issuedAtTs,
        expiresAtTs: issuedAtTs + opts.linkTtlMs,
        consumed: false,
      };
      challenges.set(challenge.linkId, challenge);
      return challenge;
    },
    completeUpgrade(linkId, applyToAccount) {
      const challenge = challenges.get(linkId);
      if (!challenge) return { ok: false, reason: 'unknown' };
      if (challenge.consumed) return { ok: false, reason: 'consumed' };
      if (opts.now() >= challenge.expiresAtTs) return { ok: false, reason: 'expired' };

      // Mark consumed before applying so a re-entrant second call can never double-apply.
      challenges.set(linkId, { ...challenge, consumed: true });
      applyToAccount(challenge.playerId, challenge.email);
      return { ok: true };
    },
  };
}
