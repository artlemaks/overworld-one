import { type LifecycleStatus, type Phase, isTerminalStatus } from '@overworld/shared';

/**
 * Map a wire combat {@link Phase} to the lifecycle status it implies — the bridge auto-recovery uses to
 * restore an FSM from a checkpointed {@link EventState} (which carries only the combat phase). The
 * combat phases (phase-1/2/3) all live inside `active`.
 */
export function lifecycleStatusForPhase(phase: Phase): LifecycleStatus {
  switch (phase) {
    case 'pending':
      return 'pending';
    case 'resolving':
      return 'resolving';
    case 'resolved':
      return 'resolved';
    default:
      return 'active';
  }
}

/**
 * Event lifecycle FSM (P2-S-1 / OOM-37).
 *
 * Owns the one authoritative answer to "what stage is this event in": pending → active → resolving →
 * resolved, with `failed` reachable from any non-terminal state (window expiry, or a forced resolve
 * during auto-recovery, P2-X-1). The P1 {@link EventEngine} derives the *combat* phase (phase-1/2/3)
 * from HP; this FSM sits above it and owns the *lifecycle*, so the two concerns don't tangle.
 *
 * **Campaign-orchestratable (the panel DoD).** A P3 campaign engine chains events by observing and
 * driving this FSM, never by editing internal state:
 *  - `onTransition` lets a campaign react to every transition (advance the arc, schedule the next beat);
 *  - `transitions()` exposes the transition log so a campaign can replay/audit an event's path;
 *  - every mutation goes through `to()`, which enforces the legal-transition table — so adding
 *    campaign-aware pacing on top needs no structural rework here.
 *
 * Pure of wall-clock and I/O: the caller supplies `now` and decides *when* to advance; this module only
 * decides *whether* a transition is legal and records it. Fully unit-testable in Node.
 */

/** The legal successors of each status. Terminal states have none. */
const ALLOWED: Record<LifecycleStatus, readonly LifecycleStatus[]> = {
  pending: ['active', 'failed'],
  active: ['resolving', 'failed'],
  resolving: ['resolved', 'failed'],
  resolved: [],
  failed: [],
};

/** One recorded transition, for campaign replay/audit. */
export interface LifecycleTransition {
  from: LifecycleStatus;
  to: LifecycleStatus;
  /** Epoch ms the transition was applied. */
  ts: number;
  /** Optional reason (e.g. `window_expired`, `recovery_force_resolve`). */
  reason?: string;
}

export interface LifecycleHooks {
  /** Called after every applied transition. A P3 campaign engine hangs its orchestration here. */
  onTransition?: (t: LifecycleTransition) => void;
}

export interface EventLifecycle {
  readonly status: LifecycleStatus;
  /** True once the event has reached `resolved` or `failed`. */
  readonly isTerminal: boolean;
  /** Whether `to(next)` would be a legal transition from the current state. */
  canTransition(next: LifecycleStatus): boolean;
  /**
   * Apply a transition. Throws on an illegal one (guards are load-bearing — a campaign must not be able
   * to skip `resolving`). Returns the recorded transition.
   */
  to(next: LifecycleStatus, reason?: string): LifecycleTransition;
  /** Convenience: fail from wherever we are (no-op returns undefined if already terminal). */
  fail(reason: string): LifecycleTransition | undefined;
  /** The ordered transition log. */
  transitions(): readonly LifecycleTransition[];
}

export interface LifecycleOptions {
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Starting status — defaults to `pending`; auto-recovery restores a mid-flight status. */
  initial?: LifecycleStatus;
  hooks?: LifecycleHooks;
}

export function createEventLifecycle(opts: LifecycleOptions): EventLifecycle {
  let status: LifecycleStatus = opts.initial ?? 'pending';
  const log: LifecycleTransition[] = [];

  const canTransition = (next: LifecycleStatus): boolean => ALLOWED[status].includes(next);

  const to = (next: LifecycleStatus, reason?: string): LifecycleTransition => {
    if (!canTransition(next)) {
      throw new Error(`illegal lifecycle transition: ${status} -> ${next}`);
    }
    const transition: LifecycleTransition = { from: status, to: next, ts: opts.now() };
    if (reason !== undefined) transition.reason = reason;
    status = next;
    log.push(transition);
    opts.hooks?.onTransition?.(transition);
    return transition;
  };

  return {
    get status() {
      return status;
    },
    get isTerminal() {
      return isTerminalStatus(status);
    },
    canTransition,
    to,
    fail(reason) {
      if (isTerminalStatus(status)) return undefined;
      return to('failed', reason);
    },
    transitions() {
      return log;
    },
  };
}
