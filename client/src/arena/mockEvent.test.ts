import { describe, it, expect } from 'vitest';
import type { EventState } from '@overworld/shared';
import { createMockEvent } from './mockEvent.js';

/** Drive the event forward in fixed steps, collecting every snapshot. */
function run(event: ReturnType<typeof createMockEvent>, stepMs: number, steps: number): EventState[] {
  const out: EventState[] = [];
  for (let i = 0; i < steps; i++) out.push(event.advance(stepMs));
  return out;
}

describe('createMockEvent', () => {
  it('rejects a non-positive hpMax', () => {
    expect(() => createMockEvent({ hpMax: 0 })).toThrow();
  });

  it('starts full and pending before the lead-in elapses', () => {
    const event = createMockEvent({ hpMax: 1000, leadInMs: 1500 });
    const initial = event.state();
    expect(initial.bossHp).toBe(1000);
    expect(initial.phase).toBe('pending');
  });

  it('never increases HP and never drops below zero', () => {
    const event = createMockEvent({ hpMax: 1000 });
    const states = run(event, 100, 400);
    let prev = 1000;
    for (const s of states) {
      expect(s.bossHp).toBeLessThanOrEqual(prev);
      expect(s.bossHp).toBeGreaterThanOrEqual(0);
      prev = s.bossHp;
    }
  });

  it('advances phases in authoritative order without skipping backwards', () => {
    const event = createMockEvent({ hpMax: 1000 });
    const order = ['pending', 'phase-1', 'phase-2', 'phase-3', 'resolving', 'resolved'];
    const seen: string[] = [];
    for (const s of run(event, 100, 400)) {
      if (seen[seen.length - 1] !== s.phase) seen.push(s.phase);
    }
    // Every phase reached appears, and each in non-decreasing order index.
    const indices = seen.map((p) => order.indexOf(p));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(seen).toContain('resolved');
  });

  it('keeps phaseProgressPct within [0, 100] throughout', () => {
    const event = createMockEvent({ hpMax: 1000 });
    for (const s of run(event, 100, 400)) {
      expect(s.phaseProgressPct).toBeGreaterThanOrEqual(0);
      expect(s.phaseProgressPct).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic for the same dt sequence', () => {
    const a = run(createMockEvent({ hpMax: 1000 }), 100, 200);
    const b = run(createMockEvent({ hpMax: 1000 }), 100, 200);
    expect(a).toEqual(b);
  });

  it('settles on resolved at zero HP', () => {
    const event = createMockEvent({ hpMax: 1000 });
    const final = run(event, 100, 500).at(-1)!;
    expect(final.bossHp).toBe(0);
    expect(final.phase).toBe('resolved');
    expect(final.phaseProgressPct).toBe(100);
  });
});
