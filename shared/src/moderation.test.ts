import { describe, it, expect } from 'vitest';
import { isCuratedCheer, screenDisplayName, ModerationReport, CURATED_CHEERS } from './moderation.js';

describe('curated expression (no free text)', () => {
  it('accepts only vocabulary tokens', () => {
    expect(isCuratedCheer('gg')).toBe(true);
    expect(isCuratedCheer(CURATED_CHEERS[0])).toBe(true);
    expect(isCuratedCheer('you are terrible')).toBe(false);
    expect(isCuratedCheer('')).toBe(false);
  });
});

describe('display-name screening', () => {
  it('accepts a clean name', () => {
    expect(screenDisplayName('Nova')).toEqual({ ok: true });
  });
  it('rejects too-short and too-long', () => {
    expect(screenDisplayName('a').ok).toBe(false);
    expect(screenDisplayName('x'.repeat(21)).ok).toBe(false);
  });
  it('rejects blocklisted substrings case-insensitively', () => {
    expect(screenDisplayName('SuperAdmin').ok).toBe(false);
    expect(screenDisplayName('xXshitXx').ok).toBe(false);
  });
});

describe('moderation report', () => {
  it('validates with defaults', () => {
    const r = ModerationReport.parse({
      reportId: 'r1',
      reporterId: 'a',
      targetPlayerId: 'b',
      reason: 'cheating',
      ts: 1,
    });
    expect(r.status).toBe('open');
    expect(r.eventId).toBeNull();
  });
  it('rejects an over-long note', () => {
    const bad = ModerationReport.safeParse({
      reportId: 'r1', reporterId: 'a', targetPlayerId: 'b', reason: 'spam', ts: 1, note: 'x'.repeat(281),
    });
    expect(bad.success).toBe(false);
  });
});
