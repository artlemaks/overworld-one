import { z } from 'zod';

/**
 * Marketing / clip-beat contracts (P6-P-1 / OOM).
 *
 * The SINGLE SOURCE OF TRUTH for the "clip-worthy moments" the client captures and the growth loop
 * distributes (scope §10, TikTok/Shorts hooks). A clip beat is a shareable spike in the event: a big
 * milestone crossing, the finishing blow, a record crowd. The client watches the tick stream and fires
 * {@link detectClipBeat} to know when to grab a highlight; the beat kind drives which caption/overlay to
 * use. Pure so the trigger logic is identical wherever it runs.
 */

/** The kinds of shareable moment worth clipping. */
export const ClipBeat = z.enum([
  'milestone-50', // objective crossed 50%
  'milestone-90', // objective crossed 90% (the tension beat)
  'finishing-blow', // the event just resolved successfully
  'record-crowd', // CCU hit a new session high
]);
export type ClipBeat = z.infer<typeof ClipBeat>;

/** Caption/overlay copy per beat, for the auto-generated clip. */
export const CLIP_CAPTIONS: Record<ClipBeat, string> = {
  'milestone-50': 'Halfway there — the crowd surges!',
  'milestone-90': 'So close! One final push!',
  'finishing-blow': 'VICTORY — we did it together!',
  'record-crowd': 'Biggest crowd yet!',
};

/** Inputs the detector compares across two consecutive ticks. */
export interface ClipDetectInput {
  prevCompletionPct: number;
  completionPct: number;
  justResolvedSuccessfully: boolean;
  ccu: number;
  sessionPeakCcuBefore: number;
}

/**
 * Detect the clip beat (if any) that just occurred between two ticks. Returns the single most notable
 * beat, prioritizing the finishing blow, then the 90% tension beat, then 50%, then a crowd record. Pure.
 */
export function detectClipBeat(input: ClipDetectInput): ClipBeat | null {
  if (input.justResolvedSuccessfully) return 'finishing-blow';
  const crossed = (mark: number): boolean =>
    input.prevCompletionPct < mark && input.completionPct >= mark;
  if (crossed(90)) return 'milestone-90';
  if (crossed(50)) return 'milestone-50';
  if (input.ccu > input.sessionPeakCcuBefore) return 'record-crowd';
  return null;
}
