import type { Account } from '@overworld/shared';

/**
 * Player profile screen model (P4-C-1 / OOM).
 *
 * The PURE, testable core of the profile screen: it maps a player's account + attendance record +
 * milestones + equipped cosmetics into a flat view-model the Pixi/DOM render layer draws. Business logic
 * lives here with no Pixi/DOM import (indication `client-screens-pure-and-testable`); the render is a
 * thin shell over this object. No clock/I/O.
 */

export interface ProfileInput {
  account: Account;
  /** Count of events the player has attended (from `event_participants`). */
  eventsAttended: number;
  /** Milestone labels the player has unlocked. */
  milestones: string[];
  /** slot -> equipped cosmeticId. */
  equipped: Record<string, string>;
  /** Current attendance streak (P4-D-1). */
  streak: number;
}

export interface ProfileViewModel {
  /** A short display name derived from the account (email local-part, else a shortened id). */
  displayName: string;
  /** Human label for the account kind. */
  kindLabel: string;
  eventsAttended: number;
  milestones: string[];
  /** How many slots have something equipped. */
  equippedCount: number;
  streak: number;
}

/** Derive a friendly display name: the email local-part when upgraded, else "Vanguard-<id6>". */
function deriveDisplayName(account: Account): string {
  if (account.kind === 'email' && account.email) {
    const local = account.email.split('@')[0];
    if (local) return local;
  }
  return `Vanguard-${account.playerId.slice(0, 6)}`;
}

/** Map profile inputs into the flat view-model the render layer consumes. Pure. */
export function profileViewModel(input: ProfileInput): ProfileViewModel {
  return {
    displayName: deriveDisplayName(input.account),
    kindLabel: input.account.kind === 'email' ? 'Registered' : 'Guest',
    eventsAttended: input.eventsAttended,
    milestones: [...input.milestones],
    equippedCount: Object.keys(input.equipped).length,
    streak: input.streak,
  };
}
