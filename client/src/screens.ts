/**
 * Screen state machine (P0-C-0 / OOM-16).
 *
 * Pure logic, no DOM — so screen flow is testable in Node. Render functions (ui/) subscribe to
 * transitions. Kept deliberately tiny; more screens (resolution, profile) extend `Screen` later.
 */

export type Screen = 'landing' | 'arena';

export interface ScreenController {
  readonly current: Screen;
  /** Move landing -> arena. Idempotent once in the arena. */
  join(): Screen;
}

export function createScreenController(
  onChange: (screen: Screen) => void = () => {},
): ScreenController {
  let current: Screen = 'landing';
  return {
    get current() {
      return current;
    },
    join() {
      if (current !== 'arena') {
        current = 'arena';
        onChange(current);
      }
      return current;
    },
  };
}
