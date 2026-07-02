/**
 * Accessibility model (P5-C-1 / OOM).
 *
 * The PURE, testable core of the accessibility surface: reduced-motion, high-contrast, text scaling,
 * audio level, and input mode (keyboard/touch/pointer). No Pixi/DOM import (indication
 * `client-screens-pure-and-testable`). The render layer reads {@link A11yState} to decide whether to
 * play juice, which contrast palette to use, and how big to draw touch targets. Immutable setters.
 */

export type InputMode = 'keyboard' | 'touch' | 'pointer';

export interface A11yState {
  /** Manual reduced-motion toggle (independent of the OS preference, which is OR'd in at resolve time). */
  reducedMotion: boolean;
  highContrast: boolean;
  /** Text scale multiplier, clamped to a sane range. */
  textScale: number;
  /** 0..1 master audio level. */
  audioLevel: number;
  inputMode: InputMode;
}

/** Sensible defaults: motion on, standard contrast, 1x text, full audio, pointer input. */
export const DEFAULT_A11Y: A11yState = {
  reducedMotion: false,
  highContrast: false,
  textScale: 1,
  audioLevel: 1,
  inputMode: 'pointer',
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

export function toggleReducedMotion(s: A11yState): A11yState {
  return { ...s, reducedMotion: !s.reducedMotion };
}

export function toggleHighContrast(s: A11yState): A11yState {
  return { ...s, highContrast: !s.highContrast };
}

/** Set text scale, clamped to [0.8, 2.0]. */
export function setTextScale(s: A11yState, scale: number): A11yState {
  return { ...s, textScale: clamp(scale, 0.8, 2) };
}

/** Set audio level, clamped to [0, 1]. */
export function setAudioLevel(s: A11yState, level: number): A11yState {
  return { ...s, audioLevel: clamp(level, 0, 1) };
}

export function setInputMode(s: A11yState, mode: InputMode): A11yState {
  return { ...s, inputMode: mode };
}

/**
 * Whether motion/juice should play: OFF if the player toggled reduced-motion OR the OS prefers reduced
 * motion. This is the single resolver the render layer consults so the two signals never disagree.
 */
export function motionEnabled(s: A11yState, osPrefersReducedMotion: boolean): boolean {
  return !s.reducedMotion && !osPrefersReducedMotion;
}

/** Touch input wants larger hit targets; the render layer scales by this factor. */
export function touchTargetScale(s: A11yState): number {
  return s.inputMode === 'touch' ? 1.5 : 1;
}
