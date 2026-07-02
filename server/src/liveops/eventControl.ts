import type { EventControlCommand, AuditLogEntry } from '@overworld/shared';
import type { EventLifecycle } from '../game/lifecycle.js';

/**
 * Live-ops event-control service (P3-X-3b / OOM-56).
 *
 * Applies the privileged operator commands defined in `@overworld/shared`'s eventControl contract
 * against a running event, and — per the scope §6 requirement — ALWAYS writes an {@link AuditLogEntry}
 * for every command, applied or rejected. The audit entry is not a side effect the caller can skip:
 * this service refuses to mutate anything without recording who did what, when, and why. Illegal
 * commands (e.g. force-resolving a terminal event, resuming an event that is not paused) leave state
 * untouched and are audited with `outcome: 'rejected'` plus a `rejectionReason`.
 *
 * Pure / dependency-injected: the clock (`now`), the id generator (`genId`), and the audit sink are all
 * supplied by the caller — no `Date.now`, no randomness, no real I/O here. Fully unit-testable in Node.
 */

/** Mutable per-event control state the operator tunes. Owned by the caller; mutated in place here. */
export interface EventControlState {
  paused: boolean;
  /** Target-completion window in ms; extend/cut adjust this. */
  windowMs: number;
  /** Phase counter thresholds, keyed by phase identifier. */
  phaseThresholds: Record<string, number>;
}

/** The lifecycle surface a control command is allowed to touch — read status, test + apply transitions. */
export type LifecycleHandle = Pick<
  EventLifecycle,
  'status' | 'isTerminal' | 'canTransition' | 'to'
>;

/** Everything a single `apply` call operates on: the target event's lifecycle + its control state. */
export interface EventControlContext {
  lifecycle: LifecycleHandle;
  control: EventControlState;
}

export interface EventControlServiceDeps {
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Injectable audit-entry id generator. */
  genId: () => string;
  /** Every applied or rejected command is written here — mandatory, not optional. */
  auditSink: (entry: AuditLogEntry) => void;
}

export interface EventControlService {
  /** Validate, apply (or reject), audit, and return the resulting {@link AuditLogEntry}. */
  apply(cmd: EventControlCommand, ctx: EventControlContext): AuditLogEntry;
}

export function createEventControlService(deps: EventControlServiceDeps): EventControlService {
  const write = (
    cmd: EventControlCommand,
    outcome: 'applied' | 'rejected',
    rejectionReason?: string,
  ): AuditLogEntry => {
    const entry: AuditLogEntry = {
      entryId: deps.genId(),
      eventId: cmd.eventId,
      operatorId: cmd.operatorId,
      type: cmd.type,
      params: cmd.params,
      reason: cmd.reason,
      ts: deps.now(),
      outcome,
    };
    if (rejectionReason !== undefined) entry.rejectionReason = rejectionReason;
    deps.auditSink(entry);
    return entry;
  };

  const apply = (cmd: EventControlCommand, ctx: EventControlContext): AuditLogEntry => {
    const { lifecycle, control } = ctx;
    const params = cmd.params;

    switch (cmd.type) {
      case 'force-resolve': {
        if (lifecycle.isTerminal) {
          return write(cmd, 'rejected', `event already terminal (${lifecycle.status})`);
        }
        // Drive toward resolution: prefer resolving, then resolved, else fail (reachable from any
        // non-terminal state). The lifecycle FSM enforces which of these is legal from here.
        const target = lifecycle.canTransition('resolving')
          ? 'resolving'
          : lifecycle.canTransition('resolved')
            ? 'resolved'
            : 'failed';
        lifecycle.to(target, 'operator_force_resolve');
        return write(cmd, 'applied');
      }
      case 'pause': {
        if (control.paused) return write(cmd, 'rejected', 'event already paused');
        control.paused = true;
        return write(cmd, 'applied');
      }
      case 'resume': {
        if (!control.paused) return write(cmd, 'rejected', 'event is not paused');
        control.paused = false;
        return write(cmd, 'applied');
      }
      case 'extend-window': {
        const ms = params['ms'];
        if (ms === undefined) return write(cmd, 'rejected', 'extend-window requires params.ms');
        control.windowMs += ms;
        return write(cmd, 'applied');
      }
      case 'cut-window': {
        const ms = params['ms'];
        if (ms === undefined) return write(cmd, 'rejected', 'cut-window requires params.ms');
        control.windowMs = Math.max(0, control.windowMs - ms);
        return write(cmd, 'applied');
      }
      case 'set-phase-threshold': {
        const phase = params['phase'];
        const threshold = params['threshold'];
        if (phase === undefined || threshold === undefined) {
          return write(cmd, 'rejected', 'set-phase-threshold requires params.phase and params.threshold');
        }
        control.phaseThresholds[String(phase)] = threshold;
        return write(cmd, 'applied');
      }
      default: {
        // Exhaustiveness guard — a new command type must be handled explicitly.
        const _never: never = cmd.type;
        return write(cmd, 'rejected', `unsupported command type: ${String(_never)}`);
      }
    }
  };

  return { apply };
}
