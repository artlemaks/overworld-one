/**
 * Graceful degradation & autoscale policy (P5-I-1 / OOM).
 *
 * The P1 DoD pins the tick floor at ≥ 3 Hz. Under a load spike the server would rather serve every
 * connected player a slightly slower but *stable* tick than drop clients — so this module owns two pure
 * policy functions the runtime consults each second:
 *
 *  - {@link tickRateForLoad} — how fast to tick given the current CCU. At/under a soft cap the server
 *    runs at its full `baseHz`; above the cap it linearly interpolates the tick rate *down* toward a
 *    `minHz` floor, trading responsiveness for headroom, and never dips below `minHz` (so the P1 3 Hz
 *    floor holds if `minHz >= 3`).
 *  - {@link autoscaleDecision} — how many nodes to run given the current CCU and per-node capacity,
 *    clamped to a sane range so we never scale to zero or past the configured ceiling.
 *
 * Pure math: no clock, no randomness, no I/O — the caller feeds in a measured snapshot and applies the
 * result. Fully unit-testable in Node.
 */

/**
 * How wide (in CCU above the soft cap) the tick rate takes to degrade the whole way from `baseHz` down to
 * `minHz`. Chosen as a multiple of the soft cap so the ramp scales with the deployment's sizing rather
 * than being a magic absolute number: at `softCapCcu + DEGRADE_SPAN_MULTIPLIER * softCapCcu` we sit at
 * the floor. `1x` means the tick rate reaches `minHz` once CCU is double the soft cap.
 */
export const DEGRADE_SPAN_MULTIPLIER = 1;

export interface TickRateInput {
  /** Current concurrent players. */
  ccu: number;
  /** Full-speed tick rate served at/under the soft cap. */
  baseHz: number;
  /** Hard floor the tick rate never drops below (keep ≥ 3 to honour the P1 DoD). */
  minHz: number;
  /** CCU at/under which the server runs at `baseHz`; above it, degradation begins. */
  softCapCcu: number;
}

/**
 * Compute the tick rate to serve for the current load. `baseHz` at/under `softCapCcu`; above it, linearly
 * interpolate toward `minHz` over a span of `DEGRADE_SPAN_MULTIPLIER * softCapCcu` extra players, floored
 * at `minHz`.
 */
export function tickRateForLoad(input: TickRateInput): number {
  const { ccu, baseHz, minHz, softCapCcu } = input;
  if (ccu <= softCapCcu) return baseHz;

  const span = DEGRADE_SPAN_MULTIPLIER * softCapCcu;
  // Degenerate span (softCapCcu <= 0): any overflow snaps straight to the floor.
  if (span <= 0) return minHz;

  const overflow = ccu - softCapCcu;
  const t = Math.min(overflow / span, 1); // 0..1 progress from soft cap to full degradation
  const degraded = baseHz - t * (baseHz - minHz);
  return Math.max(degraded, minHz);
}

export interface AutoscaleInput {
  /** Current concurrent players. */
  ccu: number;
  /** How many concurrent players one node can serve. */
  perNodeCapacity: number;
  /** Nodes currently running (informational — the decision is stateless on desired count). */
  currentNodes: number;
  /** Ceiling on node count (budget / infra limit). */
  maxNodes: number;
}

export interface AutoscaleDecision {
  /** Nodes the fleet should run: `clamp(ceil(ccu / perNodeCapacity), 1, maxNodes)`. */
  desiredNodes: number;
}

/**
 * Decide the desired node count for the current load. `desiredNodes = clamp(ceil(ccu / perNodeCapacity),
 * 1, maxNodes)` — always at least one node, never more than the configured ceiling.
 */
export function autoscaleDecision(input: AutoscaleInput): AutoscaleDecision {
  const { ccu, perNodeCapacity, maxNodes } = input;
  // Guard against a zero/negative capacity so we degrade to a single node rather than dividing by zero.
  const needed = perNodeCapacity > 0 ? Math.ceil(ccu / perNodeCapacity) : 1;
  const desiredNodes = Math.min(Math.max(needed, 1), maxNodes);
  return { desiredNodes };
}
