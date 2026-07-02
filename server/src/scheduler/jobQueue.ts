import { type JobQueue, type ScheduledJob } from './design.js';

/**
 * In-memory durable-job queue — the P3 concrete {@link JobQueue} implementation (P3-X-1 / OOM-48).
 *
 * The P1 design (`server/scheduler/design.ts`) fixed the {@link JobQueue} contract and left the impl to
 * P3. This is that impl: a single-process, `Map`-backed queue that satisfies the interface exactly so
 * the scheduler can be developed and unit-tested without external infrastructure. A Redis-backed queue
 * (multi-node, survives restart, atomic cross-node `claimDue`) is future work — this in-memory twin is
 * the reference against which that implementation's semantics are pinned.
 *
 * Semantics that matter:
 *  - `enqueue` is idempotent per job id — re-enqueuing the same id overwrites (last write wins), which is
 *    what the scheduler relies on to reschedule a recurring event without duplicating it.
 *  - `claimDue(nowTs)` atomically *returns and removes* every job whose `runAtTs <= nowTs`, ordered
 *    ascending by `runAtTs` (ties broken by insertion order) so the caller processes them in due order.
 *    Because JS is single-threaded and this method contains no `await`, the read-then-delete is atomic
 *    with respect to other queue callers — no job is handed out twice.
 *  - `ack` removes the job if it is still present (a claimed job is already gone, so `ack` on it no-ops).
 *
 * Pure of wall-clock and I/O: the caller supplies `nowTs`; the queue never reads a real clock.
 */
export function createInMemoryJobQueue(): JobQueue {
  /** Job id -> job. Insertion order is preserved by `Map`, which we lean on for stable tie-breaking. */
  const jobs = new Map<string, ScheduledJob>();

  return {
    enqueue(job: ScheduledJob): Promise<void> {
      // Last-write-wins on id lets the scheduler reschedule without accumulating duplicates.
      jobs.set(job.id, job);
      return Promise.resolve();
    },

    claimDue(nowTs: number): Promise<ScheduledJob[]> {
      const due = [...jobs.values()].filter((job) => job.runAtTs <= nowTs);
      // Ascending by runAtTs; `Array.prototype.sort` is stable, so equal runAtTs keeps insertion order.
      due.sort((a, b) => a.runAtTs - b.runAtTs);
      for (const job of due) jobs.delete(job.id);
      return Promise.resolve(due);
    },

    ack(jobId: string): Promise<void> {
      // A claimed job is already removed; ack on it (or on an unknown id) is a harmless no-op.
      jobs.delete(jobId);
      return Promise.resolve();
    },
  };
}
