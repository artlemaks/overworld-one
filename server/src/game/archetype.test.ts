import { describe, it, expect } from 'vitest';
import { ARCHETYPE_CONFIGS, combatPhaseForFraction, combatPhaseProgressPct } from '@overworld/shared';
import { applyContribution, archetypeCompletion, counterToEventState } from './archetype.js';

const boss = ARCHETYPE_CONFIGS.boss;
const structure = ARCHETYPE_CONFIGS.structure;
const threat = ARCHETYPE_CONFIGS.threat;

const presence = { contribWaveCount: 3, playersContributingNow: 12 };

describe('applyContribution', () => {
  it('drives a down archetype toward 0', () => {
    expect(applyContribution(boss, 100_000, 10_000)).toBe(90_000);
    expect(applyContribution(structure, 50_000, 20_000)).toBe(30_000);
  });

  it('drives an up archetype toward counterMax', () => {
    expect(applyContribution(threat, 0, 25_000)).toBe(25_000);
    expect(applyContribution(threat, 90_000, 5_000)).toBe(95_000);
  });

  it('clamps to [0, counterMax] in both directions', () => {
    // down cannot go below 0
    expect(applyContribution(boss, 5_000, 9_999_999)).toBe(0);
    // up cannot exceed counterMax
    expect(applyContribution(threat, 99_000, 9_999_999)).toBe(100_000);
    // a negative magnitude on a down archetype pushes back up, still clamped to counterMax
    expect(applyContribution(boss, 99_000, -9_999_999)).toBe(100_000);
  });
});

describe('archetypeCompletion', () => {
  it('is 0 at the start and 1 at the win condition for down archetypes', () => {
    expect(archetypeCompletion(boss, 100_000)).toEqual({ fraction: 0, complete: false });
    expect(archetypeCompletion(boss, 0)).toEqual({ fraction: 1, complete: true });
  });

  it('is 0 at the start and 1 at the win condition for the up (threat) archetype', () => {
    expect(archetypeCompletion(threat, 0)).toEqual({ fraction: 0, complete: false });
    expect(archetypeCompletion(threat, 100_000)).toEqual({ fraction: 1, complete: true });
  });

  it('reports the midpoint fraction', () => {
    expect(archetypeCompletion(structure, 50_000).fraction).toBeCloseTo(0.5, 10);
    expect(archetypeCompletion(threat, 50_000).fraction).toBeCloseTo(0.5, 10);
  });
});

describe('counterToEventState', () => {
  it('carries the raw counter unchanged on bossHp and copies presence (wire is archetype-blind)', () => {
    const s = counterToEventState(structure, 42_000, presence);
    expect(s.bossHp).toBe(42_000);
    expect(s.contribWaveCount).toBe(3);
    expect(s.playersContributingNow).toBe(12);

    // The wire never learns the archetype: the same raw counter yields the same phase fields.
    const bossS = counterToEventState(boss, 42_000, presence);
    expect(bossS.phase).toBe(s.phase);
    expect(bossS.phaseProgressPct).toBe(s.phaseProgressPct);
  });

  it('reproduces the original boss HP model exactly (parity)', () => {
    for (const hp of [100_000, 80_000, 66_667, 40_000, 33_333, 10_000, 0]) {
      const hpFraction = hp / boss.counterMax;
      const s = counterToEventState(boss, hp, presence);
      expect(s.phase).toBe(combatPhaseForFraction(hpFraction));
      expect(s.phaseProgressPct).toBe(combatPhaseProgressPct(hpFraction));
    }
  });

  it('maps the threat (up) archetype onto the same phase rails via remaining fraction', () => {
    // threat at distance 30_000 → completion 0.3 → remaining 0.7 → phase-1 (same as boss at 70% HP)
    const s = counterToEventState(threat, 30_000, presence);
    expect(s.phase).toBe('phase-1');
    expect(s.phase).toBe(counterToEventState(boss, 70_000, presence).phase);
  });

  it('reports phase-3 at the tail of completion for every archetype', () => {
    expect(counterToEventState(boss, 10_000, presence).phase).toBe('phase-3');
    expect(counterToEventState(structure, 10_000, presence).phase).toBe('phase-3');
    expect(counterToEventState(threat, 90_000, presence).phase).toBe('phase-3');
  });
});
