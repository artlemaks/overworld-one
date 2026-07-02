import { ModerationReport, type ReportReason } from '@overworld/shared';

/**
 * Player-report queue (P5-X-2b / OOM report queue).
 *
 * Server-side ingestion + moderation surface for the reports the P5-X-2a report UI submits. Per scope
 * §7.4, every report carries context (a target, the moment it happened, a bounded reason) so a
 * moderator can act without a free-text firehose. This queue:
 *  - validates each submission against the shared {@link ModerationReport} zod schema (the single source
 *    of truth), stamping a fresh id + timestamp and opening it as `status: 'open'`;
 *  - exposes {@link ReportQueue.open} (the moderator worklist) and {@link ReportQueue.all} (audit view);
 *  - transitions a report via {@link ReportQueue.action}, and drives the admin console's bulk control
 *    (P3-X-3a) via {@link ReportQueue.bulkAction}, which counts only the reports it actually closed.
 *
 * Pure / dependency-injected: the clock (`now`) and id generator (`genId`) are supplied by the caller —
 * no `Date.now`, no randomness, no real I/O. Fully unit-testable in Node.
 */

export interface ReportQueueDeps {
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Injectable report-id generator. */
  genId: () => string;
}

/** The submission payload the report UI sends — the queue stamps id/ts/status itself. */
export interface ReportInput {
  reporterId: string;
  targetPlayerId: string;
  reason: ReportReason;
  /** Where it happened, so a moderator has context. Optional/nullable. */
  eventId?: string | null;
  /** Short optional bounded note; never the sole signal. */
  note?: string;
}

export interface ReportQueue {
  /** Validate + enqueue a report as `open`, stamping a fresh id + timestamp. Throws on invalid input. */
  submit(input: ReportInput): ModerationReport;
  /** The moderator worklist — reports still `open`, in submission order. */
  open(): ModerationReport[];
  /** Every report ever submitted, in submission order (audit view). */
  all(): ModerationReport[];
  /**
   * Close a single report. Returns `false` if the id is unknown or the report is already closed
   * (not `open`); otherwise sets the status and returns `true`.
   */
  action(reportId: string, outcome: 'actioned' | 'dismissed'): boolean;
  /** Bulk-close many reports; returns the count actually transitioned (already-closed ones don't count). */
  bulkAction(reportIds: string[], outcome: 'actioned' | 'dismissed'): number;
}

export function createReportQueue(deps: ReportQueueDeps): ReportQueue {
  const reports: ModerationReport[] = [];
  const byId = new Map<string, ModerationReport>();

  const action = (reportId: string, outcome: 'actioned' | 'dismissed'): boolean => {
    const report = byId.get(reportId);
    if (report === undefined || report.status !== 'open') return false;
    report.status = outcome;
    return true;
  };

  return {
    submit(input) {
      const report = ModerationReport.parse({
        reportId: deps.genId(),
        reporterId: input.reporterId,
        targetPlayerId: input.targetPlayerId,
        reason: input.reason,
        eventId: input.eventId ?? null,
        note: input.note ?? '',
        ts: deps.now(),
        status: 'open',
      });
      reports.push(report);
      byId.set(report.reportId, report);
      return report;
    },
    open() {
      return reports.filter((r) => r.status === 'open');
    },
    all() {
      return [...reports];
    },
    action,
    bulkAction(reportIds, outcome) {
      let count = 0;
      for (const id of reportIds) {
        if (action(id, outcome)) count += 1;
      }
      return count;
    },
  };
}
