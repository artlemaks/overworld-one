import { describe, it, expect } from 'vitest';
import type { NextEventInfo } from '@overworld/shared';
import { countdownViewModel, formatTimer } from './countdown.js';

const info = (over: Partial<NextEventInfo> = {}): NextEventInfo => ({
  msUntilStart: 90_000,
  nextArchetype: 'boss',
  nextPacing: 'standard',
  alwaysOnSlowEvent: false,
  ...over,
});

describe('formatTimer', () => {
  it('formats seconds as m:ss', () => {
    expect(formatTimer(5_000)).toBe('0:05');
    expect(formatTimer(45_000)).toBe('0:45');
  });
  it('formats minutes as m:ss', () => {
    expect(formatTimer(90_000)).toBe('1:30');
    expect(formatTimer(15 * 60_000)).toBe('15:00');
  });
  it('formats an hour or more as Hh mm:ss', () => {
    expect(formatTimer(HOUR())).toBe('1h 00:00');
    expect(formatTimer(HOUR() + 90_000)).toBe('1h 01:30');
    expect(formatTimer(2 * HOUR() + 5_000)).toBe('2h 00:05');
  });
  it('clamps negatives to 0:00', () => {
    expect(formatTimer(-1000)).toBe('0:00');
  });
});

const HOUR = (): number => 60 * 60 * 1000;

describe('countdownViewModel', () => {
  it('reports a live event with a LIVE timer', () => {
    const v = countdownViewModel(info({ msUntilStart: 0 }));
    expect(v.isLive).toBe(true);
    expect(v.timerText).toBe('LIVE');
    expect(v.showAlwaysOnHint).toBe(false);
    expect(v.label).toBe('Boss HP event live now');
  });

  it('formats an upcoming event with a teaser and countdown (seconds)', () => {
    const v = countdownViewModel(info({ msUntilStart: 30_000 }));
    expect(v.isLive).toBe(false);
    expect(v.timerText).toBe('0:30');
    expect(v.label).toBe('Next up: Boss HP');
  });

  it('formats an upcoming event countdown in minutes', () => {
    expect(countdownViewModel(info({ msUntilStart: 5 * 60_000 })).timerText).toBe('5:00');
  });

  it('formats an upcoming event countdown in hours', () => {
    expect(countdownViewModel(info({ msUntilStart: HOUR() + 90_000 })).timerText).toBe('1h 01:30');
  });

  it('shows the always-on hint and a reassuring label when a slow event fills the gap', () => {
    const v = countdownViewModel(info({ alwaysOnSlowEvent: true, msUntilStart: 0, nextArchetype: 'threat' }));
    expect(v.showAlwaysOnHint).toBe(true);
    expect(v.label).toBe('Always something to do — Safety running now');
  });

  it('uses the per-archetype teaser label', () => {
    expect(countdownViewModel(info({ nextArchetype: 'structure' })).label).toBe('Next up: Structure');
    expect(countdownViewModel(info({ nextArchetype: 'threat' })).label).toBe('Next up: Safety');
    expect(countdownViewModel(info({ nextArchetype: 'boss' })).label).toBe('Next up: Boss HP');
  });
});
