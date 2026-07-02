import { z } from 'zod';

/**
 * Light challenge-on-first-contribution contract (P5-X-1 / OOM).
 *
 * The SINGLE SOURCE OF TRUTH for the defense-in-depth challenge the server issues before a client's
 * FIRST contribution (scope §7.4). P1 already rejects rapid-fire + value inflation server-side; this is
 * the *additional* bot/spam gate that P5 layers on — a proof-of-work or captcha token verified once per
 * session, deliberately cheap for a real human and annoying for a bot farm. Kept provider-agnostic: the
 * PoW variant is fully self-contained (verifiable here); a captcha variant carries an opaque token the
 * server verifies against the provider out-of-band.
 *
 * Pure schemas + a pure PoW verifier; issuance/session-tracking is server-side and DI'd.
 */

/** Which challenge modality was issued. `pow` is self-verifiable; `captcha` needs provider verification. */
export const ChallengeKind = z.enum(['pow', 'captcha']);
export type ChallengeKind = z.infer<typeof ChallengeKind>;

/** A challenge issued to a client on connect, to be solved before the first contribution. */
export const Challenge = z.object({
  challengeId: z.string().min(1),
  kind: ChallengeKind,
  /** For PoW: the prefix the hash must satisfy. For captcha: the provider site-key/nonce. */
  prompt: z.string().min(1),
  /** For PoW: required number of leading zero characters in the hash. */
  difficulty: z.number().int().nonnegative().default(4),
  issuedAtTs: z.number().int().nonnegative(),
  expiresAtTs: z.number().int().nonnegative(),
});
export type Challenge = z.infer<typeof Challenge>;

/** A client's answer: the PoW nonce, or the captcha provider token. */
export const ChallengeSolution = z.object({
  challengeId: z.string().min(1),
  /** PoW nonce or captcha token. */
  answer: z.string().min(1),
});
export type ChallengeSolution = z.infer<typeof ChallengeSolution>;

/**
 * Deterministic, dependency-free hash (FNV-1a, 32-bit) rendered as hex. Not cryptographic — sufficient
 * for a *light* PoW gate whose only job is to cost a bot farm CPU, and it keeps the verifier pure and
 * testable with no crypto import. The client runs the same function to find a qualifying nonce.
 */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Verify a PoW solution: `hash(prompt + nonce)` must start with `difficulty` leading zeros. Pure — the
 * server calls this to accept/reject a client's first-contribution gate answer.
 */
export function verifyPow(prompt: string, nonce: string, difficulty: number): boolean {
  const target = '0'.repeat(difficulty);
  return fnv1aHex(prompt + nonce).startsWith(target);
}
