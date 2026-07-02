import { escalatedCounterMax, isTerminalStatus } from '@overworld/shared';
import type { CampaignArc, CampaignBeat, CampaignProgress } from '@overworld/shared';
import type { LifecycleTransition } from './lifecycle.js';

/**
 * Campaign runner (P3-P-1 / OOM-50).
 *
 * Walks a {@link CampaignArc} beat by beat, chaining events into a narrative arc with a rising
 * difficulty curve. It orchestrates the P2 event lifecycle FSM **without ever editing its internals** —
 * exactly the seam the FSM was built for (see `lifecycle.ts`: `onTransition` + `transitions()`). The
 * caller owns the events; this runner only decides *which beat comes next* and *how big it is*:
 *
 *  1. Caller creates the runner, then calls {@link CampaignRunner.advance} to kick off beat 0. In the
 *     injected {@link CampaignRunnerOptions.startBeat} callback the caller spins up the live event and
 *     its {@link createEventLifecycle}, wiring that FSM's `onTransition` to
 *     {@link CampaignRunner.onBeatResolved}.
 *  2. When a beat's FSM reaches a terminal status (`resolved`/`failed`), `onBeatResolved` records the
 *     beat as completed and auto-advances to the next one — a fresh event, a fresh FSM, again wired back
 *     to this runner. When the arc is exhausted the runner goes {@link CampaignRunner.done}.
 *
 * ── Escalation ──────────────────────────────────────────────────────────────────────────────────
 * The counter magnitude for beat N comes *only* from the shared {@link escalatedCounterMax}, so the
 * client's campaign-track UI and this server runner compute the identical "how big is beat N" — the
 * curve lives in `@overworld/shared`, never duplicated here.
 *
 * Pure of wall-clock and I/O: the caller injects `now` and the `startBeat` effect; this module records
 * a beat-start log (mirroring the FSM's `transitions()` for replay/audit) and decides *whether* to
 * advance, never *when* real time passes. Fully unit-testable in Node.
 */

/** One recorded beat start, for campaign replay/audit (mirrors {@link LifecycleTransition}). */
export interface CampaignBeatStart {
  beatId: string;
  /** Zero-based index of the beat within the arc. */
  beatIndex: number;
  /** The escalated counter magnitude handed to `startBeat`, from {@link escalatedCounterMax}. */
  escalatedCounterMax: number;
  /** Epoch ms the beat was started. */
  ts: number;
}

export interface CampaignRunnerOptions {
  arc: CampaignArc;
  /** Injectable clock (epoch ms) — timestamps the beat-start log. */
  now: () => number;
  /**
   * Injected effect: start `beat` as a live event with the escalated counter magnitude. The caller
   * creates the event + its lifecycle FSM here and wires the FSM's `onTransition` to
   * {@link CampaignRunner.onBeatResolved}. The runner never touches the FSM directly.
   */
  startBeat: (beat: CampaignBeat, escalatedCounterMax: number) => void;
}

export interface CampaignRunner {
  /** The beat currently active or about to start; `undefined` once the arc is exhausted. */
  readonly currentBeat: CampaignBeat | undefined;
  /** True once every beat in the arc has reached a terminal status. */
  readonly done: boolean;
  /** Live progress for the campaign-track UI. `activeBeatIndex === arc.beats.length` ⇔ {@link done}. */
  progress(): CampaignProgress;
  /**
   * Start the current beat via the injected `startBeat`, using {@link escalatedCounterMax} for its
   * magnitude. Returns the beat started, or `undefined` when the arc is already exhausted. Throws if a
   * beat is already active (a beat must resolve before the next one starts).
   */
  advance(): CampaignBeat | undefined;
  /**
   * Wire this to each beat's lifecycle FSM `onTransition`. Non-terminal transitions are ignored; a
   * terminal one (`resolved`/`failed`) records the beat completed and auto-advances to the next beat.
   */
  onBeatResolved(transition: LifecycleTransition): void;
  /** The ordered beat-start log, for replay/audit. */
  starts(): readonly CampaignBeatStart[];
}

export function createCampaignRunner(opts: CampaignRunnerOptions): CampaignRunner {
  const { arc, now, startBeat } = opts;
  const completedBeatIds: string[] = [];
  const startsLog: CampaignBeatStart[] = [];
  /** Whether the beat at `completedBeatIds.length` has been handed to `startBeat` and not yet resolved. */
  let activeStarted = false;

  const isDone = (): boolean => completedBeatIds.length >= arc.beats.length;
  /** Index of the beat currently active or next to run — completed beats are always the prefix 0..k-1. */
  const currentIndex = (): number => completedBeatIds.length;

  const advance = (): CampaignBeat | undefined => {
    if (isDone()) return undefined;
    if (activeStarted) {
      throw new Error('campaign beat already active; it must resolve before the next beat starts');
    }
    const index = currentIndex();
    const beat = arc.beats[index];
    if (beat === undefined) return undefined; // unreachable given the isDone() guard; satisfies the index-access check
    const escalated = escalatedCounterMax(arc, index);
    activeStarted = true;
    startsLog.push({ beatId: beat.beatId, beatIndex: index, escalatedCounterMax: escalated, ts: now() });
    startBeat(beat, escalated);
    return beat;
  };

  const onBeatResolved = (transition: LifecycleTransition): void => {
    if (!isTerminalStatus(transition.to)) return; // fires on every transition; only terminal ones advance
    if (!activeStarted || isDone()) return; // ignore stray/duplicate terminal signals
    const beat = arc.beats[currentIndex()];
    if (beat === undefined) return;
    completedBeatIds.push(beat.beatId);
    activeStarted = false;
    if (!isDone()) advance();
  };

  return {
    get currentBeat() {
      return arc.beats[currentIndex()];
    },
    get done() {
      return isDone();
    },
    progress(): CampaignProgress {
      return {
        campaignId: arc.campaignId,
        activeBeatIndex: currentIndex(),
        completedBeatIds: [...completedBeatIds],
      };
    },
    advance,
    onBeatResolved,
    starts() {
      return startsLog;
    },
  };
}
