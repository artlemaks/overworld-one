import { describe, it, expect } from 'vitest';
import { profileViewModel, type ProfileInput } from './profile.js';
import type { Account } from '@overworld/shared';

const anon: Account = {
  playerId: 'abcdef123456',
  kind: 'anonymous',
  email: null,
  createdAtTs: 0,
  lastSeenTs: 0,
};
const emailAcct: Account = { ...anon, kind: 'email', email: 'nova@example.com' };

const base: ProfileInput = {
  account: anon,
  eventsAttended: 3,
  milestones: ['first-strike', 'ten-events'],
  equipped: { avatar: 'c1', badge: 'c2' },
  streak: 4,
};

describe('profileViewModel', () => {
  it('derives a guest display name + label for an anonymous account', () => {
    const vm = profileViewModel(base);
    expect(vm.displayName).toBe('Vanguard-abcdef');
    expect(vm.kindLabel).toBe('Guest');
  });

  it('uses the email local-part + registered label once upgraded', () => {
    const vm = profileViewModel({ ...base, account: emailAcct });
    expect(vm.displayName).toBe('nova');
    expect(vm.kindLabel).toBe('Registered');
  });

  it('passes through attendance/milestones/streak and counts equipped slots', () => {
    const vm = profileViewModel(base);
    expect(vm.eventsAttended).toBe(3);
    expect(vm.milestones).toEqual(['first-strike', 'ten-events']);
    expect(vm.equippedCount).toBe(2);
    expect(vm.streak).toBe(4);
  });

  it('copies the milestones array (no aliasing of the input)', () => {
    const vm = profileViewModel(base);
    expect(vm.milestones).not.toBe(base.milestones);
  });
});
