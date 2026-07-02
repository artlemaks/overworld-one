import { describe, it, expect } from 'vitest';
import {
  toggleAudio,
  toggleReducedMotion,
  toggleConsent,
  upgradeCtaVisible,
  type SettingsState,
} from './settings.js';
import type { Account, ConsentState } from '@overworld/shared';

const settings: SettingsState = { audioOn: true, reducedMotion: false };
const consent: ConsentState = {
  playerId: 'p1',
  analytics: false,
  marketingEmail: false,
  updatedAtTs: 0,
};

describe('settings model', () => {
  it('toggles audio + reduced-motion immutably', () => {
    const a = toggleAudio(settings);
    expect(a.audioOn).toBe(false);
    expect(settings.audioOn).toBe(true);
    const r = toggleReducedMotion(settings);
    expect(r.reducedMotion).toBe(true);
    expect(settings.reducedMotion).toBe(false);
  });

  it('flips a consent key and stamps updatedAtTs, immutably', () => {
    const next = toggleConsent(consent, 'analytics', 1234);
    expect(next.analytics).toBe(true);
    expect(next.updatedAtTs).toBe(1234);
    expect(consent.analytics).toBe(false); // input untouched
    expect(next.marketingEmail).toBe(false);
  });

  it('shows the upgrade CTA only for anonymous accounts', () => {
    const anon: Account = { playerId: 'p1', kind: 'anonymous', email: null, createdAtTs: 0, lastSeenTs: 0 };
    const email: Account = { ...anon, kind: 'email', email: 'x@y.com' };
    expect(upgradeCtaVisible(anon)).toBe(true);
    expect(upgradeCtaVisible(email)).toBe(false);
  });
});
