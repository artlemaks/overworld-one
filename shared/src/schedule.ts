import { z } from 'zod';
import { Archetype } from './archetype.js';

/**
 * Scheduling contracts shared across the client/server boundary (P3-X-1 / OOM-48, P3-C-1 / OOM-53).
 *
 * The server-internal durable job queue + slow-event policy already live as a *design* in
 * `server/scheduler/design.ts` (from P1-X-3) and get implemented server-side in P3. This module holds
 * only what actually crosses the wire: the pacing band enum (shared with campaigns) and the
 * {@link NextEventInfo} payload the next-event countdown widget (P3-C-1) renders on the landing screen
 * and arena HUD. Kept in `/shared` so the countdown can never disagree with the scheduler about when the
 * next event opens (indication `contracts-single-source-of-truth`).
 */

/** Pacing band for an event — how aggressively its target-completion window is enforced. */
export const PacingBand = z.enum(['slow', 'standard', 'marquee']);
export type PacingBand = z.infer<typeof PacingBand>;

/**
 * Server -> client: what the countdown widget needs. Either an event is live now (`msUntilStart === 0`)
 * or one is scheduled. `alwaysOnSlowEvent` tells the widget an off-peak slow event is filling the gap,
 * so it can say "always something to do" rather than showing a bare timer (empty-arena mitigation, P3).
 */
export const NextEventInfo = z.object({
  /** ms until the next scheduled event opens; 0 means one is live right now. */
  msUntilStart: z.number().int().nonnegative(),
  /** Archetype of the next (or current) event, for a teaser label. */
  nextArchetype: Archetype,
  nextPacing: PacingBand,
  /** True when an always-on slow event is currently live filling off-peak time. */
  alwaysOnSlowEvent: z.boolean(),
});
export type NextEventInfo = z.infer<typeof NextEventInfo>;
