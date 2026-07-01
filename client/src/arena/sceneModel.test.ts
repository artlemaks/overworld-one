import { describe, it, expect } from 'vitest';
import type { EventState, Phase } from '@overworld/shared';
import { toArenaView, PHASE_LABELS } from './sceneModel.js';

const stateWith = (over: Partial<EventState>): EventState => ({
  bossHp: 500,
  phase: 'phase-1',
  phaseProgressPct: 40,
  contribWaveCount: 0,
  playersContributingNow: 0,
  ...over,
});

describe('toArenaView', () => {
  it('computes the HP fraction relative to the client-side max', () => {
    const view = toArenaView(stateWith({ bossHp: 750 }), 1000);
    expect(view.hpFraction).toBeCloseTo(0.75);
    expect(view.hpText).toBe('750 / 1000');
  });

  it('clamps the fraction to 1 when HP exceeds the max', () => {
    expect(toArenaView(stateWith({ bossHp: 1500 }), 1000).hpFraction).toBe(1);
  });

  it('clamps the fraction to 0 for zero or negative HP', () => {
    expect(toArenaView(stateWith({ bossHp: 0 }), 1000).hpFraction).toBe(0);
    expect(toArenaView(stateWith({ bossHp: -50 }), 1000).hpFraction).toBe(0);
  });

  it('rounds displayed HP up so a nearly-dead boss never shows 0 while alive', () => {
    expect(toArenaView(stateWith({ bossHp: 0.1 }), 1000).hpText).toBe('1 / 1000');
  });

  it('degrades to a zero fraction when the max is non-positive instead of dividing by zero', () => {
    expect(toArenaView(stateWith({ bossHp: 500 }), 0).hpFraction).toBe(0);
  });

  it('passes phase progress straight through', () => {
    expect(toArenaView(stateWith({ phaseProgressPct: 63 }), 1000).phaseProgressPct).toBe(63);
  });

  it('maps every authoritative phase to human-facing copy', () => {
    const phases: Phase[] = ['pending', 'phase-1', 'phase-2', 'phase-3', 'resolving', 'resolved'];
    for (const phase of phases) {
      const view = toArenaView(stateWith({ phase }), 1000);
      expect(view.phaseLabel).toBe(PHASE_LABELS[phase]);
      expect(view.phaseLabel.length).toBeGreaterThan(0);
    }
  });
});
