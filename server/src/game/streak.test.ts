import { describe, it, expect } from 'vitest';
import { nextStreak } from './streak.js';

describe('nextStreak', () => {
  it('starts a streak of 1 on first attendance', () => {
    expect(nextStreak(null, 10)).toEqual({ count: 1, lastEventDayIndex: 10 });
  });

  it('increments on a consecutive day', () => {
    const a = nextStreak(null, 10);
    const b = nextStreak(a, 11);
    const c = nextStreak(b, 12);
    expect(b).toEqual({ count: 2, lastEventDayIndex: 11 });
    expect(c).toEqual({ count: 3, lastEventDayIndex: 12 });
  });

  it('resets to 1 on a gap', () => {
    const prev = { count: 5, lastEventDayIndex: 10 };
    expect(nextStreak(prev, 12)).toEqual({ count: 1, lastEventDayIndex: 12 });
  });

  it('is idempotent on the same day', () => {
    const prev = { count: 3, lastEventDayIndex: 10 };
    expect(nextStreak(prev, 10)).toEqual({ count: 3, lastEventDayIndex: 10 });
    // folding the same day twice never inflates the count
    expect(nextStreak(nextStreak(prev, 10), 10)).toEqual({ count: 3, lastEventDayIndex: 10 });
  });

  it('resets on an out-of-order earlier day', () => {
    const prev = { count: 4, lastEventDayIndex: 10 };
    expect(nextStreak(prev, 8)).toEqual({ count: 1, lastEventDayIndex: 8 });
  });
});
