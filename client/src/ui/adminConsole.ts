import {
  ARCHETYPE_CONFIGS,
  EventControlCommand,
  completionFraction,
  type Archetype,
  type EventControlCommandType,
  type NextEventInfo,
  type PacingBand,
} from '@overworld/shared';

/**
 * Live-ops admin console model (P3-X-3a / OOM-57).
 *
 * The testable core of the live-ops console: a pure view-model plus command builders. The operator's
 * dashboard shows the upcoming schedule, a live snapshot of the running event (CCU / tick rate /
 * completion), a pacing slider, and a moderation queue of pending player-supplied names and reports. The
 * console issues privileged {@link EventControlCommand}s (P3-X-3b) that the server refuses without a
 * reason for the audit log, so the builder here enforces that invariant up front.
 *
 * Following indication `client-screens-pure-and-testable`, this holds no DOM/render code — the actual web
 * UI is out of scope. Every function is pure and every state update is immutable, so the whole console
 * behaviour is unit-testable in Node. The wire types come from `shared`
 * (indication `contracts-single-source-of-truth`).
 */

/** One row of the upcoming-events schedule the console lists. */
export interface ScheduleRow {
  archetype: Archetype;
  /** ms until this event opens; 0 means it is live now. */
  msUntil: number;
}

/** The live snapshot the console's headline stats render. */
export interface LiveViewModel {
  /** Concurrent connected users. */
  ccu: number;
  /** Server tick rate in Hz. */
  tickHz: number;
  /** Event completion as a 0..100 percentage. */
  completionPct: number;
}

/** One pending moderation item — a submitted name or a player report awaiting an operator decision. */
export interface QueueItem {
  id: string;
  kind: 'name' | 'report';
  subject: string;
}

/** The full console view-model: schedule, live stats, pacing slider, and the moderation queue. */
export interface ConsoleState {
  scheduleRows: readonly ScheduleRow[];
  live: LiveViewModel;
  /** Current pacing-slider position, as a shared {@link PacingBand}. */
  pacingSlider: PacingBand;
  queue: readonly QueueItem[];
}

/** Operator input for issuing a control command; mirrors the shared {@link EventControlCommand} fields. */
export interface ControlCommandInput {
  eventId: string;
  operatorId: string;
  type: EventControlCommandType;
  /** Per-type numeric params (e.g. `{ ms: 60000 }`); optional, defaults to empty. */
  params?: Record<string, number>;
  /** Mandatory audit-log justification — the builder throws when it is blank. */
  reason: string;
}

/** A tick-snapshot-ish input for {@link liveViewModel}: enough to derive the headline stats. */
export interface LiveSnapshotInput {
  ccu: number;
  /** Wall-clock duration of one server tick, in ms; the display converts it to Hz. */
  tickDurationMs: number;
  /** Archetype of the live event, so completion is read through the right lens. */
  archetype: Archetype;
  /** Raw authoritative counter value for the live event. */
  counter: number;
}

/**
 * Build the schedule rows from `NextEventInfo`-like inputs (only `nextArchetype` + `msUntilStart` are
 * needed here). Pure — returns a fresh array the console can hold in {@link ConsoleState}.
 */
export function buildScheduleRows(
  infos: readonly Pick<NextEventInfo, 'nextArchetype' | 'msUntilStart'>[],
): ScheduleRow[] {
  return infos.map((info) => ({ archetype: info.nextArchetype, msUntil: info.msUntilStart }));
}

/**
 * Map a tick snapshot to the {@link LiveViewModel} the console headline shows. `tickHz` is derived from
 * the tick duration (0 when the duration is non-positive, to avoid dividing by zero); `completionPct` is
 * the archetype-blind completion fraction scaled to 0..100.
 */
export function liveViewModel(snapshot: LiveSnapshotInput): LiveViewModel {
  const tickHz = snapshot.tickDurationMs > 0 ? 1000 / snapshot.tickDurationMs : 0;
  const cfg = ARCHETYPE_CONFIGS[snapshot.archetype];
  return {
    ccu: snapshot.ccu,
    tickHz,
    completionPct: completionFraction(cfg, snapshot.counter) * 100,
  };
}

/**
 * Assemble a valid shared {@link EventControlCommand} from operator input. Throws when `reason` is blank
 * (whitespace-only counts as blank) — the audit log is mandatory for these privileged mutations. The
 * assembled command is validated through the shared schema so it can never drift from the wire contract.
 */
export function buildControlCommand(input: ControlCommandInput): EventControlCommand {
  if (input.reason.trim().length === 0) {
    throw new Error('A reason is required for every control command (it lands in the audit log).');
  }
  return EventControlCommand.parse({
    eventId: input.eventId,
    operatorId: input.operatorId,
    type: input.type,
    params: input.params ?? {},
    reason: input.reason,
  });
}

/**
 * Immutably remove the acted-on items from the moderation queue. Both `approve` and `reject` clear the
 * item from the pending queue (the downstream effect of the decision is applied server-side); the console
 * only tracks what is still awaiting a decision. Returns a new {@link ConsoleState}; the input is untouched.
 */
export function applyBulkQueueAction(
  state: ConsoleState,
  ids: readonly string[],
  _action: 'approve' | 'reject',
): ConsoleState {
  const acted = new Set(ids);
  return {
    ...state,
    queue: state.queue.filter((item) => !acted.has(item.id)),
  };
}
