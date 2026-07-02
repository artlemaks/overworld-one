import { z } from 'zod';
import { Archetype } from './archetype.js';
import { PacingBand } from './schedule.js';

/**
 * Campaign arc / event-chaining contracts (P3-P-1 / OOM-50).
 *
 * The SINGLE SOURCE OF TRUTH for a *campaign* — an ordered chain of events with a narrative and an
 * escalation curve. A campaign never edits event internals; it orchestrates the P2 lifecycle FSM by
 * scheduling the next beat when the previous one resolves (the FSM exposed `onTransition`/`transitions()`
 * for exactly this — see `server/game/lifecycle.ts`). This module defines the *shape* of a campaign; the
 * runner that walks it lives server-side (`server/game/campaign.ts`).
 *
 * ── Escalation ──────────────────────────────────────────────────────────────────────────────────
 * Each successive beat is harder: `counterMax` scales by the arc's escalation curve so beat N is a
 * bigger fight than beat N-1. {@link escalatedCounterMax} is the pure function that computes it, kept
 * here so the client's campaign-track UI and the server runner agree on the curve.
 */

/** One beat (event) in a campaign, in narrative order. */
export const CampaignBeat = z.object({
  beatId: z.string().min(1),
  /** Display title, e.g. "The Gathering Storm". */
  title: z.string().min(1),
  /** Which archetype this beat plays as. */
  archetype: Archetype,
  pacing: PacingBand,
  /** Base counter magnitude before escalation is applied. */
  baseCounterMax: z.number().positive(),
  /** Optional narrative blurb shown before the beat starts. */
  narration: z.string().default(''),
});
export type CampaignBeat = z.infer<typeof CampaignBeat>;

/** A full campaign arc: an ordered list of beats plus the escalation curve applied across them. */
export const CampaignArc = z.object({
  campaignId: z.string().min(1),
  title: z.string().min(1),
  beats: z.array(CampaignBeat).min(1),
  /**
   * Per-beat multiplicative escalation. Beat index `i` gets `baseCounterMax * escalationPerBeat**i`.
   * `1` = flat; `>1` = each beat is bigger than the last. Kept modest so the arc stays winnable.
   */
  escalationPerBeat: z.number().positive().default(1.25),
});
export type CampaignArc = z.infer<typeof CampaignArc>;

/**
 * The escalated counter magnitude for a beat at a given zero-based index. Pure; the client campaign-track
 * UI and the server campaign runner both call this so the "how big is beat N" answer is identical.
 */
export function escalatedCounterMax(arc: CampaignArc, beatIndex: number): number {
  const beat = arc.beats[beatIndex];
  if (beat === undefined) throw new RangeError(`beat index ${beatIndex} out of range`);
  return beat.baseCounterMax * arc.escalationPerBeat ** beatIndex;
}

/** Live progress through a campaign, for the campaign-track UI. `activeBeatIndex === beats.length` = done. */
export const CampaignProgress = z.object({
  campaignId: z.string().min(1),
  activeBeatIndex: z.number().int().nonnegative(),
  /** beatIds already resolved (completed or failed), in order. */
  completedBeatIds: z.array(z.string()),
});
export type CampaignProgress = z.infer<typeof CampaignProgress>;
