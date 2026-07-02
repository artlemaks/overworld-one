import type { Account, ConsentState } from '@overworld/shared';

/**
 * Settings screen model (P4-C-3 / OOM).
 *
 * The PURE, testable core of the settings screen: audio + reduced-motion/accessibility toggles, the
 * account-upgrade CTA state, and privacy-consent editing. No Pixi/DOM import (indication
 * `client-screens-pure-and-testable`). Consent edits produce a fresh {@link ConsentState} the server
 * persists; the privacy gate (`privacy.ts`) reads the same shape, so the toggle here and the server's
 * enforcement can never disagree.
 */

/** Local accessibility/audio preferences. Persisted client-side; not part of the wire contract. */
export interface SettingsState {
  audioOn: boolean;
  /** Accessibility: honor prefers-reduced-motion / manual toggle. */
  reducedMotion: boolean;
}

/** Toggle audio, immutably. */
export function toggleAudio(state: SettingsState): SettingsState {
  return { ...state, audioOn: !state.audioOn };
}

/** Toggle reduced-motion, immutably. */
export function toggleReducedMotion(state: SettingsState): SettingsState {
  return { ...state, reducedMotion: !state.reducedMotion };
}

/**
 * Flip one consent key, immutably, stamping `updatedAtTs` from the injected clock so the retention/audit
 * record is accurate. Default-deny consent lives server-side; this only records the player's choice.
 */
export function toggleConsent(
  consent: ConsentState,
  key: 'analytics' | 'marketingEmail',
  now: number,
): ConsentState {
  return { ...consent, [key]: !consent[key], updatedAtTs: now };
}

/** The "upgrade to save your progress" CTA shows only for still-anonymous accounts. */
export function upgradeCtaVisible(account: Account): boolean {
  return account.kind === 'anonymous';
}
