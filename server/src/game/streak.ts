/**
 * Attendance streak (P4-D-1 / OOM).
 *
 * The durable "days in a row a player showed up" counter, folded forward once per event at resolution and
 * persisted with the player. A consecutive day (`prev.lastEventDayIndex + 1`) extends the streak; any gap
 * (a skipped day) resets it to 1; attending again on the same day is idempotent (same count) so a
 * re-resolve after auto-recovery (P2-X-1) never inflates it.
 *
 * Pure — no clock. The caller derives the integer `eventDayIndex` from the event timestamp (e.g.
 * `floor(ts / DAY_MS)` in the player's attendance timezone) and passes it in, keeping day-boundary policy
 * out of this reducer.
 */

/** The persisted streak state. `null` means the player has no prior attendance. */
export interface StreakState {
  /** Consecutive days attended, ending on `lastEventDayIndex`. Always >= 1 once set. */
  count: number;
  /** The integer day index of the most recent attended event. */
  lastEventDayIndex: number;
}

/**
 * Fold today's attendance into the streak.
 *  - no prior state → a streak of 1;
 *  - same day as last → unchanged (idempotent);
 *  - exactly the next day → +1;
 *  - any other gap (including an out-of-order earlier day) → reset to 1.
 */
export function nextStreak(prev: StreakState | null, eventDayIndex: number): StreakState {
  if (!prev) {
    return { count: 1, lastEventDayIndex: eventDayIndex };
  }
  if (eventDayIndex === prev.lastEventDayIndex) {
    return { count: prev.count, lastEventDayIndex: prev.lastEventDayIndex };
  }
  if (eventDayIndex === prev.lastEventDayIndex + 1) {
    return { count: prev.count + 1, lastEventDayIndex: eventDayIndex };
  }
  return { count: 1, lastEventDayIndex: eventDayIndex };
}
