import { z } from 'zod';

/**
 * Moderation & player-reporting contracts (P5-X-2 name moderation / P5-X-2a report UI / P5-X-2b queue).
 *
 * The SINGLE SOURCE OF TRUTH for the safety surface. Two rules from scope §7.4 shape it:
 *  1. **No free text in-world.** Expression is a CURATED set of cheers/emotes only — there is no chat.
 *     Display names are filtered against a blocklist; anything not clean is rejected, not shown-then-
 *     reported. {@link CURATED_CHEERS} is the entire vocabulary a player can broadcast.
 *  2. **Reports carry context.** A report ties a target to the moment (event, contribution/milestone)
 *     plus a bounded reason, so a moderator can act without a free-text firehose.
 *
 * Pure schemas + a pure name-filter predicate; the queue/ingestion is server-side and DI'd.
 */

/** The complete curated cheer/emote vocabulary — the ONLY things a player can broadcast (no free text). */
export const CURATED_CHEERS = [
  'nice-hit',
  'lets-go',
  'rally',
  'almost-there',
  'gg',
  'thanks',
  'watch-out',
  'push',
] as const;
export type CuratedCheer = (typeof CURATED_CHEERS)[number];

/** Whether a broadcast token is in the curated vocabulary (rejects anything free-text). */
export function isCuratedCheer(token: string): token is CuratedCheer {
  return (CURATED_CHEERS as readonly string[]).includes(token);
}

/** Reasons a player can pick when reporting (bounded — no free-text-only reports). */
export const ReportReason = z.enum([
  'offensive-name',
  'cheating',
  'harassment',
  'spam',
  'other',
]);
export type ReportReason = z.infer<typeof ReportReason>;

/** A player report with context (P5-X-2a). `note` is short + optional; the reason is the load-bearing field. */
export const ModerationReport = z.object({
  reportId: z.string().min(1),
  reporterId: z.string().min(1),
  targetPlayerId: z.string().min(1),
  reason: ReportReason,
  /** Where it happened, so a moderator has context. */
  eventId: z.string().min(1).nullable().default(null),
  /** Short optional free-text (bounded); never the sole signal. */
  note: z.string().max(280).default(''),
  ts: z.number().int().nonnegative(),
  status: z.enum(['open', 'actioned', 'dismissed']).default('open'),
});
export type ModerationReport = z.infer<typeof ModerationReport>;

/**
 * A small display-name blocklist (substring, case-insensitive). Real deployments extend this from a
 * managed list; kept inline so the filter is testable and the client + server agree on the rule.
 */
export const NAME_BLOCKLIST = ['admin', 'moderator', 'slur1', 'slur2', 'nazi', 'fuck', 'shit'] as const;

/**
 * Whether a proposed display name is acceptable: non-empty, within length, and containing no blocklisted
 * substring. Names are filtered at set-time (rejected), consistent with "no free text shown then
 * reported". Returns a reason on failure for the UI to show.
 */
export function screenDisplayName(name: string): { ok: boolean; reason?: string } {
  const trimmed = name.trim();
  if (trimmed.length < 2) return { ok: false, reason: 'too-short' };
  if (trimmed.length > 20) return { ok: false, reason: 'too-long' };
  const lower = trimmed.toLowerCase();
  for (const bad of NAME_BLOCKLIST) {
    if (lower.includes(bad)) return { ok: false, reason: 'blocked-word' };
  }
  return { ok: true };
}
