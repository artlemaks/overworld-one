import { ARCHETYPE_CONFIGS, type NextEventInfo } from '@overworld/shared';

/**
 * Next-event countdown widget model (P3-C-1 / OOM-53).
 *
 * Renders the {@link NextEventInfo} the scheduler pushes to the landing screen and arena HUD: either an
 * event is live now, or one is coming and we tease it with a `mm:ss` (or `Hh mm:ss`) timer. When an
 * always-on slow event is filling off-peak time, the widget says "always something to do" rather than
 * showing a bare countdown (empty-arena mitigation, P3).
 *
 * Following indication `client-screens-pure-and-testable`, this is a **pure** view-model: a function that
 * maps the shared contract payload into the strings the render layer draws. No Pixi/DOM here, no
 * `Date.now()` — everything the widget shows is decided from `info.msUntilStart`, which the server owns
 * (indication `contracts-single-source-of-truth`). Fully unit-testable in Node.
 */

/** The fully-formatted view model — every field the countdown widget shows, decided here. */
export interface CountdownViewModel {
  /** Teaser copy, e.g. "Boss HP event live now" or "Next up: Structure". */
  label: string;
  /** The timer string, `mm:ss` / `Hh mm:ss`, or the literal `LIVE` when an event is live. */
  timerText: string;
  /** True when an event is running right now (`msUntilStart === 0`). */
  isLive: boolean;
  /** True when an always-on slow event is filling the gap, so the hint copy should show. */
  showAlwaysOnHint: boolean;
}

/**
 * Format a non-negative millisecond duration as `mm:ss`, or `Hh mm:ss` once it reaches an hour.
 * `90000` -> `"1:30"`; `3_690_000` -> `"1h 01:30"`. Clamps negatives to `0:00`.
 */
export function formatTimer(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mmss = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  if (hours > 0) return `${hours}h ${mmss}`;
  // Under an hour we drop the leading minute pad so it reads like a familiar bare timer.
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** The archetype teaser label, e.g. "Boss HP", from the shared per-archetype config. */
function teaser(info: NextEventInfo): string {
  return ARCHETYPE_CONFIGS[info.nextArchetype].labels.counterName;
}

/**
 * Pure mapping from the wire {@link NextEventInfo} to the {@link CountdownViewModel} the widget renders.
 *
 * - `msUntilStart === 0` → an event is live; `timerText` is `LIVE` and `isLive` is true.
 * - `alwaysOnSlowEvent` → `showAlwaysOnHint` is true and the label reassures the player there is always
 *   something to do (regardless of whether the next event is live or still counting down).
 * - otherwise → a teaser label plus the formatted countdown to the next event.
 */
export function countdownViewModel(info: NextEventInfo): CountdownViewModel {
  const isLive = info.msUntilStart === 0;
  const showAlwaysOnHint = info.alwaysOnSlowEvent;
  const name = teaser(info);

  let label: string;
  if (showAlwaysOnHint) {
    // Off-peak slow event is filling the gap — reassure rather than show a bare timer.
    label = `Always something to do — ${name} running now`;
  } else if (isLive) {
    label = `${name} event live now`;
  } else {
    label = `Next up: ${name}`;
  }

  return {
    label,
    timerText: isLive ? 'LIVE' : formatTimer(info.msUntilStart),
    isLive,
    showAlwaysOnHint,
  };
}
