import { ContributionMessage } from '@overworld/shared';
import type { Strike } from './contribution.js';

/**
 * Local scoring placeholder (P0-C-4 / OOM-20).
 *
 * The client's job here is deliberately narrow: take a resolved {@link Strike} (aim + timing skill
 * signals from `contribution.ts`) and (a) shape it into the shared `ContributionMessage` that P1's
 * netcode (OOM-32) will send, and (b) produce a *provisional* local score so the P0 prototype can
 * give immediate feedback before a server exists.
 *
 * Two boundaries are load-bearing and must survive into P1:
 *  - **The server owns the real score (P1-S-3).** `estimateLocalScore` is a throwaway placeholder for
 *    local feel only — it is NOT authoritative and is replaced by the server's value in P1. Nothing
 *    downstream should treat it as the truth.
 *  - **The wire shape is defined once in `shared/` (contracts-single-source-of-truth).** We build the
 *    message and run it through `ContributionMessage.parse`, so any drift between what the client
 *    emits and the shared schema is a hard failure, not a silent divergence.
 *
 * Pure and deterministic (no clock, no random) so it is fully unit-testable in Node — same discipline
 * as `contribution.ts` / `mockEvent.ts`.
 */

/** Upper bound of the provisional local score. Arbitrary P0 feel value; the server is authoritative. */
export const LOCAL_SCORE_MAX = 100;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/**
 * Pack a strike's skill signals into the opaque `inputParams` bag of the wire contract. The server
 * re-derives the authoritative score from these (P1-S-3); the client asserts none of its own.
 */
export function toInputParams(strike: Strike): Record<string, number> {
  return {
    aimAccuracy: strike.aimAccuracy,
    timingQuality: strike.timingQuality,
    accuracy: strike.accuracy,
    aimX: strike.aim.x,
    aimY: strike.aim.y,
    distance: strike.distance,
  };
}

/**
 * Shape a resolved strike into the shared `ContributionMessage`. Parsed through the shared Zod schema
 * so the emitted shape can never drift from the single source of truth (throws on a bad `playerId`,
 * an out-of-contract field, etc.).
 */
export function toContributionMessage(strike: Strike, playerId: string): ContributionMessage {
  return ContributionMessage.parse({
    playerId,
    actionType: strike.actionType,
    inputParams: toInputParams(strike),
    clientTs: strike.clientTs,
  });
}

/**
 * Provisional local score for a strike — a placeholder for P0 feel only, replaced by the server's
 * authoritative value in P1 (P1-S-3). It scales purely with the player's skill (`accuracy`): there is
 * deliberately **no** pass-tier or purchase multiplier, so this path cannot become pay-to-win
 * (enforce-non-p2w-guardrail).
 */
export function estimateLocalScore(strike: Strike): number {
  return Math.round(LOCAL_SCORE_MAX * clamp01(strike.accuracy));
}

/** A strike shaped for the wire plus its provisional local score. */
export interface ScoredContribution {
  /** The contribution shaped to the shared contract, ready for the P1 netcode to send. */
  message: ContributionMessage;
  /** Provisional local score (non-authoritative; server replaces it in P1). */
  localScore: number;
}

/**
 * The one call the runtime uses: turn a resolved strike into a wire-shaped `ContributionMessage` and
 * a provisional local score in a single step.
 */
export function scoreStrike(strike: Strike, playerId: string): ScoredContribution {
  return {
    message: toContributionMessage(strike, playerId),
    localScore: estimateLocalScore(strike),
  };
}
