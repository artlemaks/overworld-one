import { describe, it, expect } from 'vitest';
import { nextEventInfo, createScheduler } from './scheduler.js';
import { createInMemoryJobQueue } from './jobQueue.js';
import { type ScheduledEventConfig } from './design.js';

function cfg(overrides: Partial<ScheduledEventConfig> = {}): ScheduledEventConfig {
  return {
    archetype: 'boss',
    cadence: '1000', // every 1000 ms
    durationMs: 500,
    pacing: 'marquee',
    hpMax: 1000,
    ...overrides,
  };
}

describe('nextEventInfo', () => {
  it('computes ms until the next "every N ms" occurrence', () => {
    // now=250 in a 1000ms cadence → 750ms until the next opening.
    const info = nextEventInfo([cfg({ cadence: '1000' })], false, 250);
    expect(info.msUntilStart).toBe(750);
    expect(info.nextArchetype).toBe('boss');
    expect(info.nextPacing).toBe('marquee');
    expect(info.alwaysOnSlowEvent).toBe(false);
  });

  it('treats a 0 remainder as live now (msUntilStart === 0)', () => {
    expect(nextEventInfo([cfg({ cadence: '1000' })], false, 3000).msUntilStart).toBe(0);
    expect(nextEventInfo([cfg({ cadence: '1000' })], false, 0).msUntilStart).toBe(0);
  });

  it('picks the soonest event across the schedule', () => {
    const info = nextEventInfo(
      [
        cfg({ cadence: '1000', archetype: 'boss' }), // next at 1000 → 200 away
        cfg({ cadence: '300', archetype: 'threat', pacing: 'slow' }), // next at 900 → 100 away
      ],
      true,
      800,
    );
    expect(info.msUntilStart).toBe(100);
    expect(info.nextArchetype).toBe('threat');
    expect(info.nextPacing).toBe('slow');
    expect(info.alwaysOnSlowEvent).toBe(true);
  });

  it('surfaces slowEventActive verbatim as alwaysOnSlowEvent', () => {
    expect(nextEventInfo([cfg()], true, 10).alwaysOnSlowEvent).toBe(true);
    expect(nextEventInfo([cfg()], false, 10).alwaysOnSlowEvent).toBe(false);
  });

  it('ignores unusable cadences and uses the remaining ones', () => {
    const info = nextEventInfo(
      [cfg({ cadence: 'not-a-number' }), cfg({ cadence: '0' }), cfg({ cadence: '1000' })],
      false,
      250,
    );
    expect(info.msUntilStart).toBe(750);
  });

  it('throws when no cadence is usable', () => {
    expect(() => nextEventInfo([cfg({ cadence: 'nope' })], false, 0)).toThrow();
    expect(() => nextEventInfo([], false, 0)).toThrow();
  });
});

describe('createScheduler', () => {
  it('start enqueues a durable start-event job per config at its next occurrence', async () => {
    const queue = createInMemoryJobQueue();
    const scheduler = createScheduler({ queue, now: () => 250 });

    const jobs = await scheduler.start([
      cfg({ cadence: '1000', archetype: 'boss' }),
      cfg({ cadence: '400', archetype: 'structure' }),
    ]);

    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ id: 'start-event:0', kind: 'start-event', runAtTs: 1000 });
    expect(jobs[1]).toMatchObject({ id: 'start-event:1', kind: 'start-event', runAtTs: 400 });
    // Payload carries the event config for the worker that fires the job.
    expect(jobs[0]?.payload).toMatchObject({ archetype: 'boss', cadence: '1000', hpMax: 1000 });
  });

  it('enqueued jobs are claimable from the queue when due', async () => {
    const queue = createInMemoryJobQueue();
    const scheduler = createScheduler({ queue, now: () => 100 }); // next 500ms opening is at 500
    await scheduler.start([cfg({ cadence: '500' })]);

    expect(await queue.claimDue(499)).toEqual([]);
    const due = await queue.claimDue(500);
    expect(due.map((j) => j.id)).toEqual(['start-event:0']);
  });

  it('re-running start reschedules the same slot without duplicating', async () => {
    const queue = createInMemoryJobQueue();
    let t = 250;
    const scheduler = createScheduler({ queue, now: () => t });

    await scheduler.start([cfg({ cadence: '1000' })]); // runAt 1000
    t = 700;
    await scheduler.start([cfg({ cadence: '1000' })]); // reschedule → runAt 1000 again, same id

    const due = await queue.claimDue(10_000);
    expect(due).toHaveLength(1);
    expect(due[0]?.id).toBe('start-event:0');
  });

  it('skips configs with an unusable cadence', async () => {
    const queue = createInMemoryJobQueue();
    const scheduler = createScheduler({ queue, now: () => 0 });
    const jobs = await scheduler.start([cfg({ cadence: 'bad' }), cfg({ cadence: '500' })]);
    expect(jobs.map((j) => j.id)).toEqual(['start-event:1']);
  });

  it('stop acks every job the scheduler enqueued', async () => {
    const queue = createInMemoryJobQueue();
    const scheduler = createScheduler({ queue, now: () => 0 });
    await scheduler.start([cfg({ cadence: '500' }), cfg({ cadence: '500' })]);

    await scheduler.stop();

    expect(await queue.claimDue(10_000)).toEqual([]);
  });
});
