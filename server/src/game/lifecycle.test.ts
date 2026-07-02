import { describe, it, expect, vi } from 'vitest';
import { createEventLifecycle, type LifecycleTransition } from './lifecycle.js';

const clock = (start = 1000): (() => number) => {
  let t = start;
  return () => (t += 10);
};

describe('event lifecycle FSM', () => {
  it('starts pending by default', () => {
    const fsm = createEventLifecycle({ now: clock() });
    expect(fsm.status).toBe('pending');
    expect(fsm.isTerminal).toBe(false);
  });

  it('walks the happy path pending -> active -> resolving -> resolved', () => {
    const fsm = createEventLifecycle({ now: clock() });
    fsm.to('active');
    fsm.to('resolving');
    fsm.to('resolved');
    expect(fsm.status).toBe('resolved');
    expect(fsm.isTerminal).toBe(true);
    expect(fsm.transitions().map((t) => t.to)).toEqual(['active', 'resolving', 'resolved']);
  });

  it('rejects an illegal skip (guards are load-bearing for campaign orchestration)', () => {
    const fsm = createEventLifecycle({ now: clock() });
    expect(() => fsm.to('resolving')).toThrow(/illegal lifecycle transition: pending -> resolving/);
    expect(fsm.status).toBe('pending');
  });

  it('can fail from any non-terminal state with a reason', () => {
    const fsm = createEventLifecycle({ now: clock() });
    fsm.to('active');
    const t = fsm.fail('window_expired');
    expect(fsm.status).toBe('failed');
    expect(t?.reason).toBe('window_expired');
    expect(fsm.isTerminal).toBe(true);
  });

  it('fail() is a no-op once terminal', () => {
    const fsm = createEventLifecycle({ now: clock() });
    fsm.to('active');
    fsm.to('resolving');
    fsm.to('resolved');
    expect(fsm.fail('too_late')).toBeUndefined();
    expect(fsm.status).toBe('resolved');
  });

  it('allows no transition out of a terminal state', () => {
    const fsm = createEventLifecycle({ now: clock() });
    fsm.fail('boom');
    expect(fsm.canTransition('active')).toBe(false);
    expect(() => fsm.to('active')).toThrow();
  });

  it('notifies the onTransition hook for campaign orchestration', () => {
    const seen: LifecycleTransition[] = [];
    const onTransition = vi.fn((t: LifecycleTransition) => seen.push(t));
    const fsm = createEventLifecycle({ now: clock(), hooks: { onTransition } });
    fsm.to('active');
    fsm.to('failed', 'recovery_force_resolve');
    expect(onTransition).toHaveBeenCalledTimes(2);
    expect(seen[1]).toMatchObject({ from: 'active', to: 'failed', reason: 'recovery_force_resolve' });
  });

  it('restores a mid-flight status for auto-recovery', () => {
    const fsm = createEventLifecycle({ now: clock(), initial: 'active' });
    expect(fsm.status).toBe('active');
    fsm.to('resolving');
    expect(fsm.status).toBe('resolving');
  });

  it('stamps each transition with the injected clock', () => {
    const fsm = createEventLifecycle({ now: clock(1000) });
    fsm.to('active');
    fsm.to('resolving');
    const ts = fsm.transitions().map((t) => t.ts);
    expect(ts[0]).toBeLessThan(ts[1]!);
  });
});
