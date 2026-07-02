import { describe, it, expect } from 'vitest';
import type { EventControlCommand, AuditLogEntry, LifecycleStatus } from '@overworld/shared';
import { createEventLifecycle } from '../game/lifecycle.js';
import {
  createEventControlService,
  type EventControlState,
  type EventControlContext,
} from './eventControl.js';

function harness(initial: LifecycleStatus = 'active') {
  let t = 1_700_000_000_000;
  let seq = 0;
  const audits: AuditLogEntry[] = [];
  const svc = createEventControlService({
    now: () => t,
    genId: () => `audit-${++seq}`,
    auditSink: (e) => audits.push(e),
  });
  const lifecycle = createEventLifecycle({ now: () => t, initial });
  const control: EventControlState = { paused: false, windowMs: 60_000, phaseThresholds: {} };
  const ctx: EventControlContext = { lifecycle, control };
  return { svc, ctx, control, lifecycle, audits, setNow: (v: number) => (t = v) };
}

function cmd(over: Partial<EventControlCommand> & Pick<EventControlCommand, 'type'>): EventControlCommand {
  return {
    eventId: 'evt-1',
    operatorId: 'op-1',
    params: {},
    reason: 'because ops said so',
    ...over,
  };
}

describe('createEventControlService — applied + audited', () => {
  it('pauses a running event and audits it', () => {
    const { svc, ctx, control, audits } = harness();
    const entry = svc.apply(cmd({ type: 'pause' }), ctx);
    expect(control.paused).toBe(true);
    expect(entry.outcome).toBe('applied');
    expect(entry.entryId).toBe('audit-1');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toBe(entry);
  });

  it('resumes a paused event and audits it', () => {
    const { svc, ctx, control } = harness();
    control.paused = true;
    const entry = svc.apply(cmd({ type: 'resume' }), ctx);
    expect(control.paused).toBe(false);
    expect(entry.outcome).toBe('applied');
  });

  it('force-resolves a non-terminal event by driving the lifecycle toward resolving', () => {
    const { svc, ctx, lifecycle, audits } = harness('active');
    const entry = svc.apply(cmd({ type: 'force-resolve' }), ctx);
    expect(entry.outcome).toBe('applied');
    expect(lifecycle.status).toBe('resolving');
    expect(audits).toHaveLength(1);
  });

  it('force-resolves a pending event by failing it (resolving is not legal from pending)', () => {
    const { svc, ctx, lifecycle } = harness('pending');
    const entry = svc.apply(cmd({ type: 'force-resolve' }), ctx);
    expect(entry.outcome).toBe('applied');
    expect(lifecycle.status).toBe('failed');
  });

  it('sets a phase threshold from the numeric params bag', () => {
    const { svc, ctx, control } = harness();
    const entry = svc.apply(cmd({ type: 'set-phase-threshold', params: { phase: 2, threshold: 45_000 } }), ctx);
    expect(entry.outcome).toBe('applied');
    expect(control.phaseThresholds['2']).toBe(45_000);
  });
});

describe('createEventControlService — window math', () => {
  it('extends the window by params.ms', () => {
    const { svc, ctx, control } = harness();
    svc.apply(cmd({ type: 'extend-window', params: { ms: 30_000 } }), ctx);
    expect(control.windowMs).toBe(90_000);
  });

  it('cuts the window by params.ms', () => {
    const { svc, ctx, control } = harness();
    svc.apply(cmd({ type: 'cut-window', params: { ms: 20_000 } }), ctx);
    expect(control.windowMs).toBe(40_000);
  });

  it('floors a cut at 0 and never goes negative', () => {
    const { svc, ctx, control } = harness();
    svc.apply(cmd({ type: 'cut-window', params: { ms: 9_999_999 } }), ctx);
    expect(control.windowMs).toBe(0);
  });
});

describe('createEventControlService — rejected but still audited', () => {
  it('rejects force-resolve on a terminal event and audits the rejection', () => {
    const { svc, ctx, lifecycle, audits } = harness('resolved');
    const entry = svc.apply(cmd({ type: 'force-resolve' }), ctx);
    expect(entry.outcome).toBe('rejected');
    expect(entry.rejectionReason).toContain('terminal');
    expect(lifecycle.status).toBe('resolved'); // untouched
    expect(audits).toHaveLength(1);
    expect(audits[0]?.outcome).toBe('rejected');
  });

  it('rejects resume when the event is not paused and audits the rejection', () => {
    const { svc, ctx, control, audits } = harness();
    const entry = svc.apply(cmd({ type: 'resume' }), ctx);
    expect(entry.outcome).toBe('rejected');
    expect(entry.rejectionReason).toContain('not paused');
    expect(control.paused).toBe(false);
    expect(audits).toHaveLength(1);
  });

  it('rejects pause when already paused and audits the rejection', () => {
    const { svc, ctx, control } = harness();
    control.paused = true;
    const entry = svc.apply(cmd({ type: 'pause' }), ctx);
    expect(entry.outcome).toBe('rejected');
    expect(entry.rejectionReason).toContain('already paused');
  });

  it('always writes an audit entry — applied and rejected alike carry the operator + reason', () => {
    const { svc, ctx } = harness();
    const entry = svc.apply(cmd({ type: 'pause', operatorId: 'op-7', reason: 'load test' }), ctx);
    expect(entry.operatorId).toBe('op-7');
    expect(entry.reason).toBe('load test');
    expect(entry.ts).toBe(1_700_000_000_000);
  });
});
