import { describe, it, expect } from 'vitest';
import { ContributionMessage, TickSnapshot, EventState } from './contracts.js';

describe('ContributionMessage', () => {
  it('accepts a well-formed contribution and defaults inputParams to empty', () => {
    const parsed = ContributionMessage.parse({
      playerId: 'p1',
      actionType: 'strike',
      clientTs: 1000,
    });
    expect(parsed.inputParams).toEqual({});
    expect(parsed.actionType).toBe('strike');
  });

  it('rejects an unknown actionType', () => {
    const result = ContributionMessage.safeParse({
      playerId: 'p1',
      actionType: 'teleport',
      clientTs: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty playerId', () => {
    const result = ContributionMessage.safeParse({
      playerId: '',
      actionType: 'strike',
      clientTs: 1000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative clientTs', () => {
    const result = ContributionMessage.safeParse({
      playerId: 'p1',
      actionType: 'strike',
      clientTs: -5,
    });
    expect(result.success).toBe(false);
  });
});

describe('EventState', () => {
  it('rejects phaseProgressPct outside 0..100', () => {
    const base = {
      bossHp: 500,
      phase: 'phase-1' as const,
      contribWaveCount: 0,
      playersContributingNow: 0,
    };
    expect(EventState.safeParse({ ...base, phaseProgressPct: 150 }).success).toBe(false);
    expect(EventState.safeParse({ ...base, phaseProgressPct: 50 }).success).toBe(true);
  });
});

describe('TickSnapshot', () => {
  it('round-trips an aggregate-only snapshot (no per-player data on the wire)', () => {
    const snap = {
      eventState: {
        bossHp: 900,
        phase: 'phase-2' as const,
        phaseProgressPct: 42,
        contribWaveCount: 7,
        playersContributingNow: 128,
      },
      aggregateStats: { contribDelta: 340, contribRate: 55.5 },
      serverTs: 2000,
    };
    const parsed = TickSnapshot.parse(snap);
    expect(parsed).toEqual(snap);
    expect(parsed).not.toHaveProperty('players');
  });
});
