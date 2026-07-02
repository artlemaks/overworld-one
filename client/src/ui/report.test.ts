import { describe, it, expect } from 'vitest';
import { REPORT_REASONS, canSubmit, buildReport, type ReportDraft } from './report.js';

const draft = (over: Partial<ReportDraft> = {}): ReportDraft => ({
  reporterId: 'r',
  targetPlayerId: 't',
  reason: 'cheating',
  eventId: 'e1',
  note: '',
  ...over,
});

describe('report model', () => {
  it('offers the bounded reason set', () => {
    expect(REPORT_REASONS).toContain('cheating');
    expect(REPORT_REASONS).toContain('offensive-name');
  });

  it('requires a reason + target to submit', () => {
    expect(canSubmit(draft())).toBe(true);
    expect(canSubmit(draft({ reason: null }))).toBe(false);
    expect(canSubmit(draft({ targetPlayerId: '' }))).toBe(false);
  });

  it('rejects an over-long note', () => {
    expect(canSubmit(draft({ note: 'x'.repeat(281) }))).toBe(false);
  });

  it('builds a validated open report with injected id + ts', () => {
    const r = buildReport(draft({ note: 'saw a bot' }), 'rep-1', 999);
    expect(r.reportId).toBe('rep-1');
    expect(r.ts).toBe(999);
    expect(r.status).toBe('open');
    expect(r.reason).toBe('cheating');
  });

  it('throws when building from a non-submittable draft', () => {
    expect(() => buildReport(draft({ reason: null }), 'x', 1)).toThrow();
  });
});
