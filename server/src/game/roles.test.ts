import { describe, it, expect } from 'vitest';
import { ROLES, ROLE_AFFINITY_BONUS, ROLE_PROFILES, type ActionType, type Role } from '@overworld/shared';
import { createRoleRegistry } from './roles.js';

const EVENT = 'evt-1';
const ACTIONS: readonly ActionType[] = ['strike', 'support', 'rally'];

describe('createRoleRegistry', () => {
  it('records a selection and reads it back', () => {
    const reg = createRoleRegistry();
    expect(reg.roleOf(EVENT, 'p1')).toBeUndefined();

    expect(reg.select({ eventId: EVENT, playerId: 'p1', role: 'striker' })).toBe('striker');
    expect(reg.roleOf(EVENT, 'p1')).toBe('striker');
  });

  it('is idempotent for a repeat of the same role', () => {
    const reg = createRoleRegistry();
    reg.select({ eventId: EVENT, playerId: 'p1', role: 'supporter' });
    expect(() => reg.select({ eventId: EVENT, playerId: 'p1', role: 'supporter' })).not.toThrow();
    expect(reg.roleOf(EVENT, 'p1')).toBe('supporter');
  });

  it('rejects a mid-event role change (role is fixed for the event)', () => {
    const reg = createRoleRegistry();
    reg.select({ eventId: EVENT, playerId: 'p1', role: 'striker' });
    expect(() => reg.select({ eventId: EVENT, playerId: 'p1', role: 'rallier' })).toThrow(/fixed for the event/);
    expect(reg.roleOf(EVENT, 'p1')).toBe('striker'); // unchanged
  });

  it('scopes roles per event — the same player may hold different roles in different events', () => {
    const reg = createRoleRegistry();
    reg.select({ eventId: 'evt-a', playerId: 'p1', role: 'striker' });
    reg.select({ eventId: 'evt-b', playerId: 'p1', role: 'rallier' });
    expect(reg.roleOf('evt-a', 'p1')).toBe('striker');
    expect(reg.roleOf('evt-b', 'p1')).toBe('rallier');
  });

  it('applies the affinity bonus to the affine action', () => {
    const reg = createRoleRegistry();
    reg.select({ eventId: EVENT, playerId: 'p1', role: 'striker' });
    // striker is affine to 'strike'.
    expect(reg.applyRoleMultiplier(EVENT, 'p1', 'strike', 100)).toBeCloseTo(100 * (1 + ROLE_AFFINITY_BONUS));
    // non-affine actions stay at parity.
    expect(reg.applyRoleMultiplier(EVENT, 'p1', 'support', 100)).toBe(100);
    expect(reg.applyRoleMultiplier(EVENT, 'p1', 'rally', 100)).toBe(100);
  });

  it('passes the base value through unchanged when the player has no role', () => {
    const reg = createRoleRegistry();
    expect(reg.applyRoleMultiplier(EVENT, 'nobody', 'strike', 250)).toBe(250);
  });

  it('is symmetric — no role can out-output another across all actions (never pay-to-win)', () => {
    const reg = createRoleRegistry();
    // Each role's summed multiplier over all three actions is identical, so total achievable output
    // is role-independent — the P4-X-1 guardrail holds.
    const totalFor = (role: Role): number => {
      reg.select({ eventId: `evt-${role}`, playerId: role, role });
      return ACTIONS.reduce((sum, a) => sum + reg.applyRoleMultiplier(`evt-${role}`, role, a, 100), 0);
    };
    const totals = ROLES.map(totalFor);
    for (const total of totals) expect(total).toBeCloseTo(totals[0]!);

    // And each role's affine action is a bijection onto a distinct action (no shared favourite).
    const affine = new Set(ROLES.map((r) => ROLE_PROFILES[r].affineAction));
    expect(affine.size).toBe(ROLES.length);
  });
});
