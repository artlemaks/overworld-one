import { ModerationReport } from '@overworld/shared';
import type { ReportReason } from '@overworld/shared';

/**
 * Player report screen model (P5-X-2a / OOM).
 *
 * The PURE, testable core of the in-context report flow: a report button surfaces in a
 * contribution/milestone context, the player picks a bounded {@link ReportReason} + an optional short
 * note, and this builds a validated {@link ModerationReport} for the server queue (P5-X-2b). No Pixi/DOM
 * import (indication `client-screens-pure-and-testable`). There is deliberately no free-text-only report
 * — the reason is mandatory and load-bearing.
 */

/** The reasons the report picker offers, in display order. */
export const REPORT_REASONS: readonly ReportReason[] = [
  'offensive-name',
  'cheating',
  'harassment',
  'spam',
  'other',
];

/** A draft the report form holds before submit. */
export interface ReportDraft {
  reporterId: string;
  targetPlayerId: string;
  reason: ReportReason | null;
  eventId: string | null;
  note: string;
}

/** Whether the draft is complete enough to submit (a reason must be chosen; note is optional/bounded). */
export function canSubmit(draft: ReportDraft): boolean {
  return draft.reason !== null && draft.note.length <= 280 && draft.targetPlayerId.length > 0;
}

/**
 * Build a validated {@link ModerationReport} from a submittable draft. `reportId` + `ts` are injected
 * (no clock/random in the model). Throws if the draft is not submittable or fails schema validation.
 */
export function buildReport(draft: ReportDraft, reportId: string, ts: number): ModerationReport {
  if (!canSubmit(draft) || draft.reason === null) {
    throw new Error('report draft is not submittable');
  }
  return ModerationReport.parse({
    reportId,
    reporterId: draft.reporterId,
    targetPlayerId: draft.targetPlayerId,
    reason: draft.reason,
    eventId: draft.eventId,
    note: draft.note,
    ts,
    status: 'open',
  });
}
