/**
 * Screen state machine (P0-C-0 / OOM-16; resolution added P2-C-1 / OOM-46).
 *
 * Pure logic, no DOM — so screen flow is testable in Node. Render functions (ui/) subscribe to
 * transitions. Kept deliberately tiny; more screens (profile) extend `Screen` later.
 *
 * Flow: `landing` --join--> `arena` --resolve--> `resolution` --next--> `arena` (the next event opens
 * in the same arena, so the resolution screen's countdown loops the player back in).
 */

export type Screen = 'landing' | 'arena' | 'resolution';

export interface ScreenController {
  readonly current: Screen;
  /** Move landing -> arena. Idempotent once past landing. */
  join(): Screen;
  /** Event resolved: arena -> resolution. Only valid from the arena. */
  resolve(): Screen;
  /** Next event opens: resolution -> arena. Only valid from the resolution screen. */
  next(): Screen;
}

export function createScreenController(
  onChange: (screen: Screen) => void = () => {},
): ScreenController {
  let current: Screen = 'landing';

  const transition = (to: Screen): Screen => {
    if (current !== to) {
      current = to;
      onChange(current);
    }
    return current;
  };

  return {
    get current() {
      return current;
    },
    join() {
      return current === 'landing' ? transition('arena') : current;
    },
    resolve() {
      return current === 'arena' ? transition('resolution') : current;
    },
    next() {
      return current === 'resolution' ? transition('arena') : current;
    },
  };
}
