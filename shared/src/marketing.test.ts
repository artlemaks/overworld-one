import { describe, it, expect } from 'vitest';
import { CLIP_CAPTIONS, detectClipBeat, type ClipDetectInput } from './marketing.js';

const input = (over: Partial<ClipDetectInput>): ClipDetectInput => ({
  prevCompletionPct: 0,
  completionPct: 0,
  justResolvedSuccessfully: false,
  ccu: 10,
  sessionPeakCcuBefore: 10,
  ...over,
});

describe('clip-beat detection', () => {
  it('has a caption for every beat', () => {
    for (const beat of Object.keys(CLIP_CAPTIONS)) {
      expect(CLIP_CAPTIONS[beat as keyof typeof CLIP_CAPTIONS].length).toBeGreaterThan(0);
    }
  });

  it('prioritizes the finishing blow above everything', () => {
    expect(detectClipBeat(input({ justResolvedSuccessfully: true, completionPct: 100 }))).toBe(
      'finishing-blow',
    );
  });

  it('fires the 90% tension beat on crossing', () => {
    expect(detectClipBeat(input({ prevCompletionPct: 88, completionPct: 91 }))).toBe('milestone-90');
  });

  it('fires the 50% beat on crossing (but not if already past)', () => {
    expect(detectClipBeat(input({ prevCompletionPct: 40, completionPct: 55 }))).toBe('milestone-50');
    expect(detectClipBeat(input({ prevCompletionPct: 60, completionPct: 65 }))).toBeNull();
  });

  it('fires a crowd record when CCU exceeds the prior peak', () => {
    expect(detectClipBeat(input({ ccu: 200, sessionPeakCcuBefore: 150 }))).toBe('record-crowd');
  });

  it('returns null on an unremarkable tick', () => {
    expect(detectClipBeat(input({ prevCompletionPct: 20, completionPct: 22 }))).toBeNull();
  });
});
