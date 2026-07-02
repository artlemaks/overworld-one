import { describe, it, expect } from 'vitest';
import {
  DEFAULT_A11Y,
  toggleReducedMotion,
  toggleHighContrast,
  setTextScale,
  setAudioLevel,
  setInputMode,
  motionEnabled,
  touchTargetScale,
} from './accessibility.js';

describe('accessibility model', () => {
  it('toggles reduced-motion + high-contrast immutably', () => {
    const a = toggleReducedMotion(DEFAULT_A11Y);
    expect(a.reducedMotion).toBe(true);
    expect(DEFAULT_A11Y.reducedMotion).toBe(false);
    expect(toggleHighContrast(DEFAULT_A11Y).highContrast).toBe(true);
  });

  it('clamps text scale to [0.8, 2]', () => {
    expect(setTextScale(DEFAULT_A11Y, 5).textScale).toBe(2);
    expect(setTextScale(DEFAULT_A11Y, 0.1).textScale).toBe(0.8);
    expect(setTextScale(DEFAULT_A11Y, 1.4).textScale).toBe(1.4);
  });

  it('clamps audio level to [0, 1]', () => {
    expect(setAudioLevel(DEFAULT_A11Y, 2).audioLevel).toBe(1);
    expect(setAudioLevel(DEFAULT_A11Y, -1).audioLevel).toBe(0);
  });

  it('resolves motion from BOTH the manual toggle and the OS preference', () => {
    expect(motionEnabled(DEFAULT_A11Y, false)).toBe(true);
    expect(motionEnabled(DEFAULT_A11Y, true)).toBe(false); // OS prefers reduced
    expect(motionEnabled(toggleReducedMotion(DEFAULT_A11Y), false)).toBe(false); // manual
  });

  it('scales touch targets up only in touch mode', () => {
    expect(touchTargetScale(setInputMode(DEFAULT_A11Y, 'touch'))).toBe(1.5);
    expect(touchTargetScale(setInputMode(DEFAULT_A11Y, 'keyboard'))).toBe(1);
  });
});
