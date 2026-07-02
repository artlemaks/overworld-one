import { describe, it, expect } from 'vitest';
import {
  combatPhaseForFraction,
  combatPhaseProgressPct,
  createPhaseTracker,
  PHASE_1_FLOOR,
  PHASE_2_FLOOR,
} from './phases.js';

describe('combatPhaseForFraction', () => {
  it('maps the upper third of HP to phase-1', () => {
    expect(combatPhaseForFraction(1)).toBe('phase-1');
    expect(combatPhaseForFraction(0.9)).toBe('phase-1');
  });

  it('maps the middle third to phase-2', () => {
    expect(combatPhaseForFraction(0.6)).toBe('phase-2');
    expect(combatPhaseForFraction(PHASE_1_FLOOR)).toBe('phase-2'); // boundary belongs to the lower phase
  });

  it('maps the lower third to phase-3', () => {
    expect(combatPhaseForFraction(0.2)).toBe('phase-3');
    expect(combatPhaseForFraction(PHASE_2_FLOOR)).toBe('phase-3');
    expect(combatPhaseForFraction(0)).toBe('phase-3');
  });

  it('clamps out-of-range fractions', () => {
    expect(combatPhaseForFraction(5)).toBe('phase-1');
    expect(combatPhaseForFraction(-1)).toBe('phase-3');
  });
});

describe('combatPhaseProgressPct', () => {
  it('is 0 at the start of a phase and ~100 at its end', () => {
    expect(combatPhaseProgressPct(1)).toBeCloseTo(0); // start of phase-1
    expect(combatPhaseProgressPct(PHASE_1_FLOOR + 1e-9)).toBeCloseTo(100, 4); // end of phase-1
    expect(combatPhaseProgressPct(PHASE_2_FLOOR + 1e-9)).toBeCloseTo(100, 4); // end of phase-2
    expect(combatPhaseProgressPct(0)).toBeCloseTo(100); // end of phase-3
  });

  it('is halfway through phase-1 at the 5/6 mark', () => {
    expect(combatPhaseProgressPct(5 / 6)).toBeCloseTo(50);
  });
});

describe('createPhaseTracker', () => {
  it('reports no transition on the first observation', () => {
    const tracker = createPhaseTracker();
    expect(tracker.update('pending')).toBeNull();
    expect(tracker.current()).toBe('pending');
  });

  it('reports a transition the frame the phase changes, once', () => {
    const tracker = createPhaseTracker();
    tracker.update('phase-1');
    expect(tracker.update('phase-2')).toEqual({ from: 'phase-1', to: 'phase-2' });
    // Same phase on the next frame → no repeat.
    expect(tracker.update('phase-2')).toBeNull();
  });

  it('tracks a full run of transitions', () => {
    const tracker = createPhaseTracker('pending');
    expect(tracker.update('pending')).toBeNull();
    expect(tracker.update('phase-1')).toEqual({ from: 'pending', to: 'phase-1' });
    expect(tracker.update('phase-2')).toEqual({ from: 'phase-1', to: 'phase-2' });
    expect(tracker.update('phase-3')).toEqual({ from: 'phase-2', to: 'phase-3' });
    expect(tracker.update('resolving')).toEqual({ from: 'phase-3', to: 'resolving' });
    expect(tracker.update('resolved')).toEqual({ from: 'resolving', to: 'resolved' });
  });

  it('honours a provided initial phase (no transition into it)', () => {
    const tracker = createPhaseTracker('phase-1');
    expect(tracker.current()).toBe('phase-1');
    expect(tracker.update('phase-1')).toBeNull();
  });
});
