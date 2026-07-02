import { describe, it, expect } from 'vitest';
import { CampaignArc, escalatedCounterMax } from '@overworld/shared';
import { createCampaignRunner } from './campaign.js';
import { createEventLifecycle } from './lifecycle.js';

/** A three-beat arc with a rising curve, built through zod so defaults (escalationPerBeat) apply. */
function makeArc() {
  return CampaignArc.parse({
    campaignId: 'camp-1',
    title: 'The Long March',
    escalationPerBeat: 2,
    beats: [
      { beatId: 'b0', title: 'Skirmish', archetype: 'boss', pacing: 'standard', baseCounterMax: 1000 },
      { beatId: 'b1', title: 'Siege', archetype: 'structure', pacing: 'standard', baseCounterMax: 1000 },
      { beatId: 'b2', title: 'Reckoning', archetype: 'threat', pacing: 'marquee', baseCounterMax: 1000 },
    ],
  });
}

/**
 * Drive a runner to completion using a real lifecycle FSM per beat, wired exactly as production does:
 * `startBeat` spins up an FSM whose `onTransition` calls back into the runner. Returns the recorded
 * `startBeat` invocations so tests can assert order + escalation.
 */
function driveWithFsm(arc: CampaignArc, resolveTerminal: (i: number) => 'resolved' | 'failed') {
  let t = 1_000;
  const started: Array<{ beatId: string; escalated: number }> = [];
  const runner = createCampaignRunner({
    arc,
    now: () => (t += 10),
    startBeat: (beat, escalated) => {
      started.push({ beatId: beat.beatId, escalated });
      const index = started.length - 1;
      const fsm = createEventLifecycle({ now: () => t, hooks: { onTransition: runner.onBeatResolved } });
      // Walk the FSM to a terminal status — driving the arc forward via onTransition only.
      fsm.to('active');
      if (resolveTerminal(index) === 'resolved') {
        fsm.to('resolving');
        fsm.to('resolved');
      } else {
        fsm.fail('window_expired');
      }
    },
  });
  return { runner, started };
}

describe('createCampaignRunner', () => {
  it('runs beats in narrative order and completes the arc', () => {
    const arc = makeArc();
    const { runner, started } = driveWithFsm(arc, () => 'resolved');

    runner.advance(); // kick off beat 0; the FSM chain auto-advances the rest

    expect(started.map((s) => s.beatId)).toEqual(['b0', 'b1', 'b2']);
    expect(runner.done).toBe(true);
    expect(runner.currentBeat).toBeUndefined();
  });

  it('applies the shared escalation curve to each beat', () => {
    const arc = makeArc();
    const { runner, started } = driveWithFsm(arc, () => 'resolved');
    runner.advance();

    // Magnitude comes only from the shared escalatedCounterMax — beat i = base * 2**i here.
    expect(started.map((s) => s.escalated)).toEqual([
      escalatedCounterMax(arc, 0),
      escalatedCounterMax(arc, 1),
      escalatedCounterMax(arc, 2),
    ]);
    expect(started.map((s) => s.escalated)).toEqual([1000, 2000, 4000]);
  });

  it('treats a failed beat as terminal and still advances the arc', () => {
    const arc = makeArc();
    // Beat 1 fails; the arc should still march on to beat 2 and finish.
    const { runner, started } = driveWithFsm(arc, (i) => (i === 1 ? 'failed' : 'resolved'));
    runner.advance();

    expect(started.map((s) => s.beatId)).toEqual(['b0', 'b1', 'b2']);
    expect(runner.done).toBe(true);
  });

  it('reflects completed beats and the active index in progress()', () => {
    const arc = makeArc();
    // Manual driving (no auto-chain) so we can inspect progress() mid-arc.
    let t = 0;
    const runner = createCampaignRunner({ arc, now: () => (t += 1), startBeat: () => {} });

    expect(runner.progress()).toEqual({ campaignId: 'camp-1', activeBeatIndex: 0, completedBeatIds: [] });

    runner.advance(); // start beat 0
    expect(runner.progress().activeBeatIndex).toBe(0);
    expect(runner.currentBeat?.beatId).toBe('b0');

    runner.onBeatResolved({ from: 'resolving', to: 'resolved', ts: 1 }); // beat 0 done -> auto-starts beat 1
    expect(runner.progress()).toEqual({
      campaignId: 'camp-1',
      activeBeatIndex: 1,
      completedBeatIds: ['b0'],
    });
    expect(runner.currentBeat?.beatId).toBe('b1');
  });

  it('ignores non-terminal transitions', () => {
    const arc = makeArc();
    let t = 0;
    const started: string[] = [];
    const runner = createCampaignRunner({
      arc,
      now: () => (t += 1),
      startBeat: (beat) => started.push(beat.beatId),
    });
    runner.advance();

    runner.onBeatResolved({ from: 'pending', to: 'active', ts: 1 });
    runner.onBeatResolved({ from: 'active', to: 'resolving', ts: 2 });

    // No beat completed, no new beat started — only beat 0 is live.
    expect(runner.progress().completedBeatIds).toEqual([]);
    expect(started).toEqual(['b0']);
  });

  it('is done after the arc is exhausted and advance() is then a no-op', () => {
    const arc = makeArc();
    const { runner } = driveWithFsm(arc, () => 'resolved');
    runner.advance();

    expect(runner.done).toBe(true);
    expect(runner.progress().activeBeatIndex).toBe(arc.beats.length);
    expect(runner.advance()).toBeUndefined();
  });

  it('rejects advancing while a beat is still active', () => {
    const arc = makeArc();
    let t = 0;
    const runner = createCampaignRunner({ arc, now: () => (t += 1), startBeat: () => {} });
    runner.advance();
    expect(() => runner.advance()).toThrow(/already active/);
  });

  it('records a beat-start log for replay/audit', () => {
    const arc = makeArc();
    const { runner } = driveWithFsm(arc, () => 'resolved');
    runner.advance();

    const starts = runner.starts();
    expect(starts.map((s) => s.beatIndex)).toEqual([0, 1, 2]);
    expect(starts.map((s) => s.beatId)).toEqual(['b0', 'b1', 'b2']);
    // Timestamps are monotonic from the injected clock.
    expect(starts[0]!.ts).toBeLessThan(starts[2]!.ts);
  });
});
