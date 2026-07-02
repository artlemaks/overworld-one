import { screenDisplayName, isCuratedCheer } from '@overworld/shared';

/**
 * Display-name & broadcast moderator (P5-X-2 / OOM name moderation).
 *
 * Enforces scope §7.4's two safety rules at the point of expression, so nothing unsafe is ever shown-
 * then-reported:
 *  1. **Names are filtered at set-time.** {@link proposeName} delegates to the shared
 *     {@link screenDisplayName} predicate (the single source of truth for the blocklist/length rules);
 *     only a clean name is recorded, and {@link nameOf} exposes the last accepted name for a player.
 *  2. **No free text in-world.** {@link validateBroadcast} accepts ONLY tokens in the curated
 *     cheer/emote vocabulary via {@link isCuratedCheer}; any free-text token is rejected.
 *
 * Pure / in-memory: the accepted-name map is the caller's to own via this instance — no clock, no
 * randomness, no real I/O. Fully unit-testable in Node.
 */

export interface NameModerator {
  /**
   * Screen a proposed display name. On `ok`, records it as this player's accepted name; on failure,
   * returns the shared screening reason for the UI and records nothing.
   */
  proposeName(playerId: string, name: string): { ok: boolean; reason?: string };
  /** The last accepted display name for a player, or `undefined` if none was ever accepted. */
  nameOf(playerId: string): string | undefined;
  /** Whether a broadcast token is allowed — curated cheers/emotes only, never free text. */
  validateBroadcast(token: string): { ok: boolean };
}

export function createNameModerator(): NameModerator {
  const accepted = new Map<string, string>();

  return {
    proposeName(playerId, name) {
      const screened = screenDisplayName(name);
      if (screened.ok) {
        accepted.set(playerId, name.trim());
      }
      return screened;
    },
    nameOf(playerId) {
      return accepted.get(playerId);
    },
    validateBroadcast(token) {
      return { ok: isCuratedCheer(token) };
    },
  };
}
