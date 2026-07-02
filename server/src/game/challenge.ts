import {
  type Challenge,
  type ChallengeSolution,
  verifyPow,
} from '@overworld/shared';

/**
 * First-contribution challenge gate (P5-X-1 / OOM).
 *
 * The server-side issuance + session-tracking half of the shared challenge contract
 * (`@overworld/shared` `challenge.ts`). On connect a client is issued a proof-of-work {@link Challenge};
 * it must be solved once, before the client's FIRST contribution is accepted. This is
 * *defense-in-depth*, layered ON TOP of the P1 server-authoritative anti-cheat (rate-anomaly detection +
 * value validation, `anticheat.ts`) — it is NOT a replacement for server auth. Its only job is to cost a
 * bot farm a burst of CPU per session while staying near-free for a real human.
 *
 * Pure / dependency-injected: the clock (`now`) and challenge-id generator (`genId`) are supplied by the
 * caller — no `Date.now`, no randomness, no real I/O. The PoW itself is verified via the shared
 * {@link verifyPow}, keeping this module and the client in agreement on the hash. Fully unit-testable in
 * Node.
 */

export interface ChallengeGateDeps {
  /** Injectable clock (epoch ms). */
  now: () => number;
  /** Injectable id generator — used for both the challenge id and the PoW prompt. */
  genId: () => string;
  /** Required number of leading zero hex chars in the PoW hash (higher = costlier for the client). */
  difficulty: number;
  /** How long an issued challenge stays solvable, in ms. */
  ttlMs: number;
}

/** Result of attempting to solve a challenge, or of gating a first contribution. */
export interface GateResult {
  ok: boolean;
  /** Machine-readable rejection reason (e.g. `unknown_challenge`, `expired`, `wrong_answer`). */
  reason?: string;
}

/** Result of the first-contribution admission check. */
export interface AdmissionResult {
  allowed: boolean;
  reason?: string;
}

/** One challenge the gate has issued, kept until solved/expired for lookup by id. */
interface IssuedChallenge {
  challenge: Challenge;
  playerId: string;
}

export interface ChallengeGate {
  /**
   * Issue a fresh PoW {@link Challenge} for a player on connect. The prompt is a freshly generated id, so
   * each session's proof-of-work is independent and a precomputed answer cannot be replayed.
   */
  issue(playerId: string): Challenge;
  /**
   * Verify a client's answer. Looks the challenge up by id, rejects if it is unknown or expired, then
   * verifies the PoW nonce via the shared {@link verifyPow}. On success the owning player is marked
   * passed for the rest of the session.
   */
  solve(solution: ChallengeSolution): GateResult;
  /** Whether the player has passed the challenge this session. */
  hasPassed(playerId: string): boolean;
  /**
   * The admission check the ingest path calls before accepting a player's FIRST contribution — allowed
   * iff the player has passed the challenge. Defense-in-depth: P1 server-auth still validates every
   * contribution regardless of this gate.
   */
  requireForFirstContribution(playerId: string): AdmissionResult;
}

export function createChallengeGate(deps: ChallengeGateDeps): ChallengeGate {
  const { now, genId, difficulty, ttlMs } = deps;
  const issued = new Map<string, IssuedChallenge>();
  const passed = new Set<string>();

  return {
    issue(playerId: string): Challenge {
      const issuedAtTs = now();
      const challenge: Challenge = {
        challengeId: genId(),
        kind: 'pow',
        prompt: genId(),
        difficulty,
        issuedAtTs,
        expiresAtTs: issuedAtTs + ttlMs,
      };
      issued.set(challenge.challengeId, { challenge, playerId });
      return challenge;
    },

    solve(solution: ChallengeSolution): GateResult {
      const entry = issued.get(solution.challengeId);
      if (entry === undefined) return { ok: false, reason: 'unknown_challenge' };
      if (now() >= entry.challenge.expiresAtTs) {
        return { ok: false, reason: 'expired' };
      }
      if (!verifyPow(entry.challenge.prompt, solution.answer, entry.challenge.difficulty)) {
        return { ok: false, reason: 'wrong_answer' };
      }
      passed.add(entry.playerId);
      return { ok: true };
    },

    hasPassed(playerId: string): boolean {
      return passed.has(playerId);
    },

    requireForFirstContribution(playerId: string): AdmissionResult {
      if (passed.has(playerId)) return { allowed: true };
      return { allowed: false, reason: 'challenge_unsolved' };
    },
  };
}
