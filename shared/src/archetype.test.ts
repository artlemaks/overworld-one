import { describe, it, expect } from 'vitest';
import {
  ARCHETYPES,
  ARCHETYPE_CONFIGS,
  completionFraction,
  isArchetypeComplete,
} from './archetype.js';

describe('archetype abstraction', () => {
  it('has a config for every archetype, keyed correctly', () => {
    for (const a of ARCHETYPES) {
      expect(ARCHETYPE_CONFIGS[a].archetype).toBe(a);
    }
  });

  it('boss/structure (down) start at 0% and win at 100%', () => {
    for (const a of ['boss', 'structure'] as const) {
      const cfg = ARCHETYPE_CONFIGS[a];
      expect(completionFraction(cfg, cfg.counterMax)).toBe(0); // full counter = fresh event
      expect(completionFraction(cfg, 0)).toBe(1); // depleted = complete
      expect(isArchetypeComplete(cfg, 0)).toBe(true);
      expect(isArchetypeComplete(cfg, cfg.counterMax)).toBe(false);
    }
  });

  it('threat (up) starts at 0% and wins by pushing the counter up to max', () => {
    const cfg = ARCHETYPE_CONFIGS.threat;
    expect(completionFraction(cfg, 0)).toBe(0);
    expect(completionFraction(cfg, cfg.counterMax)).toBe(1);
    expect(isArchetypeComplete(cfg, cfg.counterMax)).toBe(true);
    expect(isArchetypeComplete(cfg, 0)).toBe(false);
  });

  it('clamps out-of-range counters into [0,1]', () => {
    const cfg = ARCHETYPE_CONFIGS.boss;
    expect(completionFraction(cfg, cfg.counterMax * 2)).toBe(0);
    expect(completionFraction(cfg, -5)).toBe(1);
  });

  it('reports 50% at the halfway counter for both directions', () => {
    for (const a of ARCHETYPES) {
      const cfg = ARCHETYPE_CONFIGS[a];
      expect(completionFraction(cfg, cfg.counterMax / 2)).toBeCloseTo(0.5);
    }
  });
});
