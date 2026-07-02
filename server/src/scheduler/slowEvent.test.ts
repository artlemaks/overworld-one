import { describe, it, expect } from 'vitest';
import { shouldSlowEventBeLive, ensureSlowEvent } from './slowEvent.js';
import { type EmptyArenaPolicy, type SlowEventConfig } from './design.js';

const policy: EmptyArenaPolicy = { slowEventBelowCcu: 20, evaluateEveryMs: 30_000 };

const config: SlowEventConfig = {
  archetype: 'boss',
  targetCompletionMs: 6 * 60 * 60 * 1000,
  pacing: 'slow',
  hpMax: 50_000,
};

describe('shouldSlowEventBeLive', () => {
  it('is live strictly below the threshold', () => {
    expect(shouldSlowEventBeLive(policy, 0)).toBe(true);
    expect(shouldSlowEventBeLive(policy, 19)).toBe(true);
  });

  it('is not live at or above the threshold', () => {
    expect(shouldSlowEventBeLive(policy, 20)).toBe(false);
    expect(shouldSlowEventBeLive(policy, 21)).toBe(false);
    expect(shouldSlowEventBeLive(policy, 1000)).toBe(false);
  });
});

describe('ensureSlowEvent', () => {
  it('starts one when below threshold and none is live', () => {
    expect(
      ensureSlowEvent({ policy, config, sampledCcu: 5, slowEventCurrentlyLive: false }),
    ).toEqual({ action: 'start' });
  });

  it('stops it when at/above threshold and one is live', () => {
    expect(
      ensureSlowEvent({ policy, config, sampledCcu: 50, slowEventCurrentlyLive: true }),
    ).toEqual({ action: 'stop' });
  });

  it('no-ops when already in the desired state below threshold', () => {
    expect(
      ensureSlowEvent({ policy, config, sampledCcu: 5, slowEventCurrentlyLive: true }),
    ).toEqual({ action: 'noop' });
  });

  it('no-ops when already in the desired state at/above threshold', () => {
    expect(
      ensureSlowEvent({ policy, config, sampledCcu: 50, slowEventCurrentlyLive: false }),
    ).toEqual({ action: 'noop' });
  });

  it('treats the threshold itself as at/above (tears down at exactly slowEventBelowCcu)', () => {
    expect(
      ensureSlowEvent({ policy, config, sampledCcu: 20, slowEventCurrentlyLive: true }),
    ).toEqual({ action: 'stop' });
  });
});
