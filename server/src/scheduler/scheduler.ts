import { type NextEventInfo } from '@overworld/shared';
import { type JobQueue, type ScheduledEventConfig, type ScheduledJob } from './design.js';

/**
 * Event scheduler (P3-X-1 / OOM-48).
 *
 * Turns the declarative marquee {@link ScheduledEventConfig} list into (a) the {@link NextEventInfo} the
 * countdown widget renders, and (b) durable `start-event` jobs on the {@link JobQueue} so an event still
 * fires after a node restart — the design's whole reason for a job queue rather than in-memory timers.
 *
 * ── Cadence, for now ────────────────────────────────────────────────────────────────────────────
 * A {@link ScheduledEventConfig.cadence} is currently a plain "every N milliseconds" numeric string,
 * parsed with `Number()`. A real cron/RRULE parser (hour-of-day, day-of-week peak windows) is future
 * work; the field is already typed as an opaque string precisely so that upgrade needs no schema change.
 * Given cadence N, the next occurrence relative to `now` is `N - (now % N)` ms away, and a remainder of
 * `0` means an event opens exactly now — treated as *live* (`msUntilStart === 0`).
 *
 * Pure of wall-clock and I/O: `now` is injected and the queue is injected; nothing here reads a real
 * clock or touches the network. Fully unit-testable in Node.
 */

/** A parsed, upcoming occurrence of one scheduled event. */
interface Upcoming {
  config: ScheduledEventConfig;
  /** ms from `now` until this event opens; `0` means it is live now. */
  msUntilStart: number;
}

/**
 * ms until the next occurrence of a cadence, or `undefined` if the cadence is not a usable
 * "every N ms" number (non-numeric or non-positive). A remainder of `0` yields `0` — live now.
 */
function msUntilNext(cadence: string, now: number): number | undefined {
  const everyMs = Number(cadence);
  if (!Number.isFinite(everyMs) || everyMs <= 0) return undefined;
  return (everyMs - (now % everyMs)) % everyMs;
}

/** The soonest upcoming occurrence across the schedule, or `undefined` if none is usable. */
function soonest(schedule: readonly ScheduledEventConfig[], now: number): Upcoming | undefined {
  let best: Upcoming | undefined;
  for (const config of schedule) {
    const msUntilStart = msUntilNext(config.cadence, now);
    if (msUntilStart === undefined) continue;
    if (best === undefined || msUntilStart < best.msUntilStart) {
      best = { config, msUntilStart };
    }
  }
  return best;
}

/**
 * Compute the {@link NextEventInfo} for the countdown widget: the soonest upcoming (or live) event in
 * `schedule`. `slowEventActive` is surfaced verbatim as `alwaysOnSlowEvent` so the widget can say
 * "always something to do" off-peak. Throws if `schedule` has no cadence that parses to a positive
 * "every N ms" number, because there is then no next event to describe.
 */
export function nextEventInfo(
  schedule: ScheduledEventConfig[],
  slowEventActive: boolean,
  now: number,
): NextEventInfo {
  const next = soonest(schedule, now);
  if (next === undefined) {
    throw new Error('nextEventInfo: schedule has no usable cadence to compute a next event from');
  }
  return {
    msUntilStart: next.msUntilStart,
    nextArchetype: next.config.archetype,
    nextPacing: next.config.pacing,
    alwaysOnSlowEvent: slowEventActive,
  };
}

export interface SchedulerDeps {
  queue: JobQueue;
  /** Injectable clock (epoch ms). */
  now: () => number;
}

export interface Scheduler {
  /**
   * Enqueue a durable `start-event` job for each config's next occurrence and return them. Re-running
   * `start` reschedules against the current `now` (job ids are deterministic per config index, so the
   * queue's last-write-wins overwrite prevents duplicates rather than piling on).
   */
  start(schedule: ScheduledEventConfig[]): Promise<ScheduledJob[]>;
  /** Cancel every job this scheduler enqueued (acks them off the queue). */
  stop(): Promise<void>;
}

export function createScheduler(deps: SchedulerDeps): Scheduler {
  /** Ids of jobs this scheduler has enqueued, so `stop` can cancel exactly them. */
  const enqueued = new Set<string>();

  return {
    async start(schedule: ScheduledEventConfig[]): Promise<ScheduledJob[]> {
      const now = deps.now();
      const created: ScheduledJob[] = [];
      for (let i = 0; i < schedule.length; i++) {
        const config = schedule[i];
        if (config === undefined) continue;
        const msUntilStart = msUntilNext(config.cadence, now);
        if (msUntilStart === undefined) continue;
        // Deterministic id per schedule slot → re-running `start` overwrites rather than duplicates.
        const job: ScheduledJob = {
          id: `start-event:${i}`,
          kind: 'start-event',
          runAtTs: now + msUntilStart,
          payload: {
            archetype: config.archetype,
            cadence: config.cadence,
            durationMs: config.durationMs,
            pacing: config.pacing,
            hpMax: config.hpMax,
          },
        };
        await deps.queue.enqueue(job);
        enqueued.add(job.id);
        created.push(job);
      }
      return created;
    },

    async stop(): Promise<void> {
      for (const id of enqueued) {
        await deps.queue.ack(id);
      }
      enqueued.clear();
    },
  };
}
