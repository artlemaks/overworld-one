import { type EmptyArenaPolicy, type SlowEventConfig } from './design.js';

/**
 * Always-on off-peak slow-event policy (P3-X-2 / OOM-49).
 *
 * The empty-arena mitigation's first layer: below a CCU threshold there must *always* be exactly one
 * long, gently-paced event live, so a player who joins off-peak always has something to contribute to.
 * This module owns the pure decision — "given the sampled CCU and whether a slow event is currently
 * live, should we start one, stop one, or do nothing?" — and nothing else. Actually starting/stopping
 * the event (enqueuing jobs, spinning up the {@link EventEngine}) is the caller's job; keeping the
 * decision pure makes the hysteresis trivially unit-testable.
 *
 * The rule is a single threshold from {@link EmptyArenaPolicy.slowEventBelowCcu}: strictly below it the
 * slow event is live, at or above it it is torn down (peak-hour scheduled marquee events take over).
 * Pure of wall-clock and I/O.
 */

/** Whether the always-on slow event should be live at this sampled CCU (live iff below the threshold). */
export function shouldSlowEventBeLive(policy: EmptyArenaPolicy, sampledCcu: number): boolean {
  return sampledCcu < policy.slowEventBelowCcu;
}

export interface EnsureSlowEventInput {
  policy: EmptyArenaPolicy;
  /** Config of the slow event to keep alive (magnitude/pacing); carried for the caller that acts on it. */
  config: SlowEventConfig;
  /** Aggregate presence sampled this evaluation tick (P1-S-7). */
  sampledCcu: number;
  /** Whether a slow event is live right now, per the caller's own state. */
  slowEventCurrentlyLive: boolean;
}

/** The action the caller must take to reconcile the live slow event with the policy. */
export interface EnsureSlowEventResult {
  action: 'start' | 'stop' | 'noop';
}

/**
 * Reconcile "is a slow event live?" against the policy so that exactly one is alive below the CCU
 * threshold and none at/above it:
 *  - below threshold and none live  → `start`
 *  - at/above threshold and one live → `stop`
 *  - already in the desired state    → `noop`
 *
 * `config` is not consulted for the decision (the threshold alone drives it); it rides along so the
 * caller acting on a `start` has the slow-event shape to launch without a second lookup.
 */
export function ensureSlowEvent(input: EnsureSlowEventInput): EnsureSlowEventResult {
  const shouldBeLive = shouldSlowEventBeLive(input.policy, input.sampledCcu);
  if (shouldBeLive && !input.slowEventCurrentlyLive) return { action: 'start' };
  if (!shouldBeLive && input.slowEventCurrentlyLive) return { action: 'stop' };
  return { action: 'noop' };
}
