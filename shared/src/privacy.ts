import { z } from 'zod';

/**
 * Privacy & consent contracts (P4-P-1 / OOM).
 *
 * The SINGLE SOURCE OF TRUTH for the consent state the app must honor before it tracks or emails a
 * player (scope §7.1 — GDPR email consent, tracking disclosure, retention, opt-out). The privacy-review
 * gate in P4's DoD checks that analytics + email are gated on these flags. Kept in `/shared` so the
 * client settings screen and the server both read the SAME consent shape.
 *
 * Pure schema + a pure gate predicate; no clock/I/O.
 */

/** A player's consent choices. Default-deny: everything opt-in, nothing assumed. */
export const ConsentState = z.object({
  playerId: z.string().min(1),
  /** Product/behavioral analytics (PostHog). Off unless the player opts in. */
  analytics: z.boolean().default(false),
  /** Marketing / lifecycle email. Requires an upgraded (email) account + explicit opt-in. */
  marketingEmail: z.boolean().default(false),
  /** When consent was last updated, for the audit/retention record. */
  updatedAtTs: z.number().int().nonnegative(),
});
export type ConsentState = z.infer<typeof ConsentState>;

/** Retention policy the server enforces (days). Surfaced in the disclosure copy. */
export const RETENTION_DAYS = 365;

/** Whether analytics events may be emitted for this player right now. */
export function mayTrackAnalytics(consent: Pick<ConsentState, 'analytics'>): boolean {
  return consent.analytics === true;
}

/** Whether marketing email may be sent — needs explicit consent (an email account is checked separately). */
export function maySendMarketingEmail(consent: Pick<ConsentState, 'marketingEmail'>): boolean {
  return consent.marketingEmail === true;
}
