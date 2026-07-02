import { describe, it, expect } from 'vitest';
import {
  ROLES,
  ROLE_PROFILES,
  ROLE_AFFINITY_BONUS,
  roleActionMultiplier,
  RoleSelectionMessage,
} from './roles.js';
import type { ActionType } from './contracts.js';

describe('roles', () => {
  it('has a profile for every role', () => {
    for (const role of ROLES) {
      expect(ROLE_PROFILES[role].role).toBe(role);
    }
  });

  it('is a bijection role<->affine action (no two roles share an affine action)', () => {
    const actions = ROLES.map((r) => ROLE_PROFILES[r].affineAction);
    expect(new Set(actions).size).toBe(ROLES.length);
  });

  it('gives exactly the affinity bonus to the affine action and parity to others', () => {
    for (const role of ROLES) {
      const affine = ROLE_PROFILES[role].affineAction;
      expect(roleActionMultiplier(role, affine)).toBeCloseTo(1 + ROLE_AFFINITY_BONUS);
      const others: ActionType[] = (['strike', 'support', 'rally'] as ActionType[]).filter(
        (a) => a !== affine,
      );
      for (const other of others) {
        expect(roleActionMultiplier(role, other)).toBe(1);
      }
    }
  });

  it('keeps total achievable multiplier role-independent (symmetry — never pay-to-win)', () => {
    // Each role's best single action tops out at the same value; no role can exceed another.
    const bests = ROLES.map((r) => roleActionMultiplier(r, ROLE_PROFILES[r].affineAction));
    expect(new Set(bests.map((b) => b.toFixed(4))).size).toBe(1);
  });

  it('validates a role-selection message', () => {
    const ok = RoleSelectionMessage.safeParse({ playerId: 'p1', eventId: 'e1', role: 'striker' });
    expect(ok.success).toBe(true);
    const bad = RoleSelectionMessage.safeParse({ playerId: 'p1', eventId: 'e1', role: 'tank' });
    expect(bad.success).toBe(false);
  });
});
