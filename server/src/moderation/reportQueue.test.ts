import { describe, it, expect } from 'vitest';
import { createReportQueue, type ReportInput } from './reportQueue.js';

function harness() {
  let t = 1_700_000_000_000;
  let seq = 0;
  const queue = createReportQueue({
    now: () => t,
    genId: () => `report-${++seq}`,
  });
  return { queue, setNow: (v: number) => (t = v) };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    reporterId: 'reporter-1',
    targetPlayerId: 'target-1',
    reason: 'harassment',
    ...over,
  };
}

describe('createReportQueue — submit', () => {
  it('lands a report as open with stamped id/ts and preserved context', () => {
    const { queue } = harness();
    const report = queue.submit(input({ eventId: 'evt-9', note: 'said bad things' }));
    expect(report.reportId).toBe('report-1');
    expect(report.ts).toBe(1_700_000_000_000);
    expect(report.status).toBe('open');
    expect(report.reason).toBe('harassment');
    expect(report.eventId).toBe('evt-9');
    expect(report.note).toBe('said bad things');
  });

  it('defaults optional context (eventId null, empty note)', () => {
    const { queue } = harness();
    const report = queue.submit(input());
    expect(report.eventId).toBeNull();
    expect(report.note).toBe('');
  });
});

describe('createReportQueue — open() / all()', () => {
  it('open() returns only open reports while all() returns everything', () => {
    const { queue } = harness();
    const r1 = queue.submit(input());
    queue.submit(input());
    queue.action(r1.reportId, 'actioned');

    expect(queue.open()).toHaveLength(1);
    expect(queue.all()).toHaveLength(2);
    expect(queue.open()[0]?.reportId).toBe('report-2');
  });
});

describe('createReportQueue — action', () => {
  it('closes an open report and returns true', () => {
    const { queue } = harness();
    const r = queue.submit(input());
    expect(queue.action(r.reportId, 'dismissed')).toBe(true);
    expect(queue.all()[0]?.status).toBe('dismissed');
  });

  it('returns false for an unknown id', () => {
    const { queue } = harness();
    expect(queue.action('nope', 'actioned')).toBe(false);
  });

  it('returns false when the report is already closed', () => {
    const { queue } = harness();
    const r = queue.submit(input());
    expect(queue.action(r.reportId, 'actioned')).toBe(true);
    expect(queue.action(r.reportId, 'dismissed')).toBe(false);
    // Status not re-changed.
    expect(queue.all()[0]?.status).toBe('actioned');
  });
});

describe('createReportQueue — bulkAction', () => {
  it('counts only the reports it actually closed', () => {
    const { queue } = harness();
    const r1 = queue.submit(input());
    const r2 = queue.submit(input());
    const r3 = queue.submit(input());
    // Pre-close r1 so the bulk call must skip it.
    queue.action(r1.reportId, 'dismissed');

    const count = queue.bulkAction([r1.reportId, r2.reportId, r3.reportId, 'unknown'], 'actioned');
    expect(count).toBe(2);
    expect(queue.open()).toHaveLength(0);
    expect(queue.all().map((r) => r.status)).toEqual(['dismissed', 'actioned', 'actioned']);
  });
});
