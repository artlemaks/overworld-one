import { z } from 'zod';

/**
 * Live-ops event-control contracts (P3-X-3b / OOM-56; hardened in P5-X-3a).
 *
 * The SINGLE SOURCE OF TRUTH for the operator commands the live-ops console (P3-X-3a) issues against a
 * running event, and for the **audit log** every one of them writes. The scope §6 requirement is that an
 * operator can start/stop, tune pacing, extend/cut the window, pause/resume, and force-resolve a live
 * event — and that all of it is auditable. These are privileged mutations, so the contract makes the
 * audit entry mandatory: the server service (`server/liveops/eventControl.ts`) refuses to apply a command
 * without recording who did what, when, and why.
 *
 * Pure schemas; the applying service is server-side and dependency-injects its clock + audit sink.
 */

/** The privileged operations an operator can perform on a live event. */
export const EventControlCommandType = z.enum([
  /** Change a phase HP/counter threshold mid-event (re-pace without restarting). */
  'set-phase-threshold',
  /** Extend the target-completion window by N ms. */
  'extend-window',
  /** Cut the target-completion window by N ms. */
  'cut-window',
  /** Pause the event (freeze the clock + counter). */
  'pause',
  /** Resume a paused event. */
  'resume',
  /** Force the event to resolve now (grants rewards from current tallies). */
  'force-resolve',
]);
export type EventControlCommandType = z.infer<typeof EventControlCommandType>;

/**
 * One operator command. `params` is a per-type bag (e.g. `{ ms: 60000 }` for extend/cut,
 * `{ phase, threshold }` for set-phase-threshold). `reason` is mandatory — it lands in the audit log.
 */
export const EventControlCommand = z.object({
  eventId: z.string().min(1),
  operatorId: z.string().min(1),
  type: EventControlCommandType,
  params: z.record(z.string(), z.number()).default({}),
  /** Operator-supplied justification; required so the audit trail is meaningful. */
  reason: z.string().min(1),
});
export type EventControlCommand = z.infer<typeof EventControlCommand>;

/** One immutable audit-log entry. Written for every applied (or rejected) control command. */
export const AuditLogEntry = z.object({
  entryId: z.string().min(1),
  eventId: z.string().min(1),
  operatorId: z.string().min(1),
  type: EventControlCommandType,
  params: z.record(z.string(), z.number()),
  reason: z.string().min(1),
  /** Epoch ms the command was applied. */
  ts: z.number().int().nonnegative(),
  /** Whether the command was applied or rejected (e.g. illegal for the current lifecycle state). */
  outcome: z.enum(['applied', 'rejected']),
  /** Present when `outcome === 'rejected'`. */
  rejectionReason: z.string().optional(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;
