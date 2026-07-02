import { describe, it, expect } from 'vitest';
import { createInMemoryJobQueue } from './jobQueue.js';
import { type ScheduledJob } from './design.js';

function job(id: string, runAtTs: number, extra?: Partial<ScheduledJob>): ScheduledJob {
  return { id, kind: 'start-event', runAtTs, payload: {}, ...extra };
}

describe('createInMemoryJobQueue', () => {
  it('claimDue returns and removes only jobs due at/before nowTs, ascending by runAtTs', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('c', 300));
    await q.enqueue(job('a', 100));
    await q.enqueue(job('b', 200));

    const due = await q.claimDue(200);
    expect(due.map((j) => j.id)).toEqual(['a', 'b']);

    // The not-yet-due job survives and is claimable once time advances.
    const later = await q.claimDue(1000);
    expect(later.map((j) => j.id)).toEqual(['c']);
  });

  it('treats runAtTs === nowTs as due (inclusive boundary)', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('exact', 500));
    expect((await q.claimDue(499)).map((j) => j.id)).toEqual([]);
    expect((await q.claimDue(500)).map((j) => j.id)).toEqual(['exact']);
  });

  it('breaks runAtTs ties by insertion order (stable sort)', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('first', 100));
    await q.enqueue(job('second', 100));
    await q.enqueue(job('third', 100));
    expect((await q.claimDue(100)).map((j) => j.id)).toEqual(['first', 'second', 'third']);
  });

  it('never hands the same job out twice', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('once', 10));
    expect((await q.claimDue(100)).map((j) => j.id)).toEqual(['once']);
    expect(await q.claimDue(100)).toEqual([]);
  });

  it('enqueue is last-write-wins on id (reschedule without duplicating)', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('evt', 100));
    await q.enqueue(job('evt', 900)); // reschedule the same id later
    expect(await q.claimDue(500)).toEqual([]); // no longer due at 500
    const due = await q.claimDue(1000);
    expect(due.map((j) => j.id)).toEqual(['evt']);
    expect(due[0]?.runAtTs).toBe(900);
  });

  it('ack removes a pending job so it is never claimed', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('cancel-me', 100));
    await q.ack('cancel-me');
    expect(await q.claimDue(1000)).toEqual([]);
  });

  it('ack on an already-claimed or unknown id is a harmless no-op', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('x', 10));
    await q.claimDue(100); // claim removes it
    await expect(q.ack('x')).resolves.toBeUndefined();
    await expect(q.ack('never-existed')).resolves.toBeUndefined();
  });

  it('preserves the full job payload through claim', async () => {
    const q = createInMemoryJobQueue();
    await q.enqueue(job('p', 10, { kind: 'resolve-event', payload: { eventId: 'evt-9' } }));
    const [claimed] = await q.claimDue(100);
    expect(claimed).toEqual({
      id: 'p',
      kind: 'resolve-event',
      runAtTs: 10,
      payload: { eventId: 'evt-9' },
    });
  });
});
