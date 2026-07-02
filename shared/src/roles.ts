import { z } from 'zod';
import type { ActionType } from './contracts.js';

/**
 * Roles system contracts (P3-S-1 / OOM-51).
 *
 * The SINGLE SOURCE OF TRUTH for the three player roles and their *light* mechanical distinction.
 * Roles are chosen at event start and are **always free** — cosmetics get wired to them in P4, but the
 * role itself never costs anything and never grants power beyond the small, symmetric weighting below
 * (indications `contracts-single-source-of-truth`, `monetization-never-pay-to-win`).
 *
 * "Light mechanical distinction" means: each role nudges *which* contribution action is most effective,
 * not *how much* total value a player can output. The three role weightings are deliberately balanced so
 * no role is strictly better — a striker is to strikes what a rallier is to rallies. The server applies
 * {@link roleActionMultiplier} on top of its authoritative point value; the cap stays 1.0× aggregate so
 * this can never become pay-to-win (the P4-X-1 guardrail asserts exactly this).
 *
 * Pure data + a pure lookup; no clock, no I/O — fully unit-testable in Node.
 */

/** The three selectable roles. `striker` deals raw damage, `supporter` amplifies, `rallier` grows presence. */
export const Role = z.enum(['striker', 'supporter', 'rallier']);
export type Role = z.infer<typeof Role>;

/** All roles, in canonical display order. */
export const ROLES: readonly Role[] = ['striker', 'supporter', 'rallier'];

/**
 * Client -> server: the role a player picks for an event. Sent once at event join; the server records it
 * against the participant and rejects a change mid-event (role is fixed for the event's duration).
 */
export const RoleSelectionMessage = z.object({
  playerId: z.string().min(1),
  eventId: z.string().min(1),
  role: Role,
});
export type RoleSelectionMessage = z.infer<typeof RoleSelectionMessage>;

/**
 * The per-role action affinity. Each role has ONE affine action it does slightly better and treats the
 * other two at parity. `affinityBonus` is small and identical across roles, so the system is symmetric.
 */
export interface RoleProfile {
  role: Role;
  /** The action this role is tuned for. */
  affineAction: ActionType;
  /** Blurb shown on the role-select screen. */
  description: string;
}

/** The symmetric bonus an affine action receives. Small by design; the aggregate cap stays 1.0×. */
export const ROLE_AFFINITY_BONUS = 0.15;

/** Canonical role profiles. Each role is affine to exactly one action; the mapping is a bijection. */
export const ROLE_PROFILES: Record<Role, RoleProfile> = {
  striker: {
    role: 'striker',
    affineAction: 'strike',
    description: 'Front-line damage. Strikes land a little harder.',
  },
  supporter: {
    role: 'supporter',
    affineAction: 'support',
    description: 'Amplify the crowd. Support actions carry a little further.',
  },
  rallier: {
    role: 'rallier',
    affineAction: 'rally',
    description: 'Grow the numbers. Rallies pull a little more presence.',
  },
};

/**
 * The multiplier a role applies to a given action's authoritative point value. Returns
 * `1 + ROLE_AFFINITY_BONUS` for the role's affine action and exactly `1` otherwise — so total achievable
 * output is role-independent and the 1.0× aggregate guardrail (P4-X-1) is never violated.
 */
export function roleActionMultiplier(role: Role, action: ActionType): number {
  return ROLE_PROFILES[role].affineAction === action ? 1 + ROLE_AFFINITY_BONUS : 1;
}
