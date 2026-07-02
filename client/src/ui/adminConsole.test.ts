import { describe, it, expect } from 'vitest';
import type { NextEventInfo } from '@overworld/shared';
import {
  applyBulkQueueAction,
  buildControlCommand,
  buildScheduleRows,
  liveViewModel,
  type ConsoleState,
} from './adminConsole.js';

const state = (over: Partial<ConsoleState> = {}): ConsoleState => ({
  scheduleRows: [],
  live: { ccu: 0, tickHz: 0, completionPct: 0 },
  pacingSlider: 'standard',
  queue: [
    { id: 'q1', kind: 'name', subject: 'xXProGamerXx' },
    { id: 'q2', kind: 'report', subject: 'player-42 griefing' },
    { id: 'q3', kind: 'name', subject: 'TownHero' },
  ],
  ...over,
});

describe('buildControlCommand', () => {
  it('assembles a valid command and defaults params to empty', () => {
    const cmd = buildControlCommand({
      eventId: 'evt-1',
      operatorId: 'op-1',
      type: 'pause',
      reason: 'server overloaded',
    });
    expect(cmd).toEqual({
      eventId: 'evt-1',
      operatorId: 'op-1',
      type: 'pause',
      params: {},
      reason: 'server overloaded',
    });
  });

  it('carries per-type numeric params through', () => {
    const cmd = buildControlCommand({
      eventId: 'evt-1',
      operatorId: 'op-1',
      type: 'extend-window',
      params: { ms: 60_000 },
      reason: 'giving stragglers more time',
    });
    expect(cmd.params).toEqual({ ms: 60_000 });
  });

  it('throws when the reason is empty', () => {
    expect(() =>
      buildControlCommand({ eventId: 'evt-1', operatorId: 'op-1', type: 'resume', reason: '' }),
    ).toThrow(/reason is required/);
  });

  it('throws when the reason is only whitespace', () => {
    expect(() =>
      buildControlCommand({ eventId: 'evt-1', operatorId: 'op-1', type: 'resume', reason: '   ' }),
    ).toThrow(/reason is required/);
  });
});

describe('applyBulkQueueAction', () => {
  it('removes the acted-on items immutably (approve)', () => {
    const before = state();
    const after = applyBulkQueueAction(before, ['q1', 'q3'], 'approve');
    expect(after.queue.map((q) => q.id)).toEqual(['q2']);
    // original is untouched
    expect(before.queue.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    expect(after).not.toBe(before);
    expect(after.queue).not.toBe(before.queue);
  });

  it('removes the acted-on items for reject too', () => {
    const after = applyBulkQueueAction(state(), ['q2'], 'reject');
    expect(after.queue.map((q) => q.id)).toEqual(['q1', 'q3']);
  });

  it('is a no-op for ids not in the queue', () => {
    const after = applyBulkQueueAction(state(), ['nope'], 'approve');
    expect(after.queue.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
  });

  it('preserves the rest of the console state', () => {
    const before = state({ pacingSlider: 'marquee' });
    const after = applyBulkQueueAction(before, ['q1'], 'approve');
    expect(after.pacingSlider).toBe('marquee');
    expect(after.live).toBe(before.live);
  });
});

describe('liveViewModel', () => {
  it('derives tickHz from the tick duration', () => {
    const vm = liveViewModel({ ccu: 1200, tickDurationMs: 100, archetype: 'boss', counter: 100_000 });
    expect(vm.ccu).toBe(1200);
    expect(vm.tickHz).toBe(10);
  });

  it('maps completion via the archetype config (down: boss)', () => {
    // boss counterMax 100_000, direction down -> counter 25_000 == 75% complete
    expect(liveViewModel({ ccu: 0, tickDurationMs: 50, archetype: 'boss', counter: 25_000 }).completionPct).toBe(75);
  });

  it('maps completion via the archetype config (up: threat)', () => {
    // threat direction up -> counter 40_000 of 100_000 == 40% complete
    expect(liveViewModel({ ccu: 0, tickDurationMs: 50, archetype: 'threat', counter: 40_000 }).completionPct).toBe(40);
  });

  it('reports 0 Hz for a non-positive tick duration instead of dividing by zero', () => {
    expect(liveViewModel({ ccu: 5, tickDurationMs: 0, archetype: 'boss', counter: 0 }).tickHz).toBe(0);
  });
});

describe('buildScheduleRows', () => {
  it('maps NextEventInfo-like inputs to archetype + msUntil rows', () => {
    const infos: Pick<NextEventInfo, 'nextArchetype' | 'msUntilStart'>[] = [
      { nextArchetype: 'boss', msUntilStart: 0 },
      { nextArchetype: 'structure', msUntilStart: 300_000 },
      { nextArchetype: 'threat', msUntilStart: 900_000 },
    ];
    expect(buildScheduleRows(infos)).toEqual([
      { archetype: 'boss', msUntil: 0 },
      { archetype: 'structure', msUntil: 300_000 },
      { archetype: 'threat', msUntil: 900_000 },
    ]);
  });
});
