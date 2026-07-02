/**
 * Responsive arena layout (P0-C-8 / OOM-24).
 *
 * A pure mapping from viewport size to the handful of metrics the scene needs to lay itself out on
 * any device — phone portrait, phone landscape, desktop. The rules that matter for mobile live here
 * as testable arithmetic rather than magic numbers sprinkled through the renderer: the aim target is
 * never smaller than a finger (a hard floor on the strike radius), the boss sits higher in portrait
 * to leave thumb room, and bars/text scale with the smaller screen dimension.
 *
 * Plus {@link prefersReducedMotion} — a thin, injectable read of the OS "reduce motion" setting the
 * caller uses to dial the OOM-21 juice down. No Pixi/DOM state here, so it is unit-testable in Node.
 */

export type Orientation = 'portrait' | 'landscape';

export interface ArenaLayout {
  orientation: Orientation;
  /** Boss vertical centre as a fraction of height (higher in portrait for thumb room). */
  bossCenterYFraction: number;
  /** Boss sprite scale, sized off the smaller dimension so it fits portrait. */
  bossScale: number;
  /** Aim-ring radius in px — also the touch target, floored at a finger-friendly minimum. */
  strikeRadius: number;
  /** HP bar width in px. */
  hpBarWidth: number;
  /** Scale for UI text/bars. */
  uiScale: number;
}

export interface LayoutOptions {
  /** Minimum aim-ring radius in px; keeps the tap target reachable on small screens. Default 44. */
  minTouchRadiusPx?: number;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Compute layout metrics for a `width × height` viewport. */
export function computeArenaLayout(
  width: number,
  height: number,
  options: LayoutOptions = {},
): ArenaLayout {
  const minTouchRadiusPx = options.minTouchRadiusPx ?? 44;
  const w = Math.max(0, width);
  const h = Math.max(0, height);
  const minDim = Math.min(w, h);
  const orientation: Orientation = w >= h ? 'landscape' : 'portrait';

  // Portrait aims a touch wider (thumbs) and seats the boss higher to clear the lower tap zone.
  const radiusFraction = orientation === 'portrait' ? 0.44 : 0.4;
  const strikeRadius = Math.max(minTouchRadiusPx, minDim * radiusFraction);

  return {
    orientation,
    bossCenterYFraction: orientation === 'portrait' ? 0.4 : 0.46,
    bossScale: clamp(minDim / 700, 0.5, 1.4),
    strikeRadius,
    hpBarWidth: Math.min(560, w * (orientation === 'portrait' ? 0.86 : 0.7)),
    uiScale: clamp(minDim / 520, 0.85, 1.2),
  };
}

/** Minimal `matchMedia` surface — satisfied by `window`; a stub is injected in tests. */
export interface MediaQueryHost {
  matchMedia?: (query: string) => { matches: boolean };
}

/**
 * Whether the user has asked the OS to reduce motion. Injectable (`host`) so it is testable in Node;
 * defaults to the global `window`. Safe when `matchMedia` is absent (returns `false`).
 */
export function prefersReducedMotion(host: MediaQueryHost = globalThis as MediaQueryHost): boolean {
  const mq = host.matchMedia?.('(prefers-reduced-motion: reduce)');
  return mq?.matches ?? false;
}
