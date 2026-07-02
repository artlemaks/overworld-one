import { z } from 'zod';

/**
 * Premium currency ("sparks") ledger contracts (P4-D-2 / OOM-26).
 *
 * The SINGLE SOURCE OF TRUTH for the sparks ledger. Sparks are an append-only ledger, not a mutable
 * balance field: every credit (purchase, ad reward, pass grant) and debit (store spend) is an immutable
 * {@link SparkLedgerEntry}, and the balance is *derived* by folding the log ({@link sparkBalance}). This
 * makes spend auditable and idempotent (`entryId` dedupes a double-submitted purchase) and means a
 * balance can never drift from its history. Sparks buy cosmetics only — never power (P4-X-1).
 *
 * Pure fold; no clock/I/O (callers stamp `ts`).
 */

/** Why a ledger entry exists. Credits add sparks; debits spend them. */
export const SparkReason = z.enum([
  'purchase', // bought sparks with real money (credit)
  'ad-reward', // rewarded-ad top-up (credit)
  'pass-grant', // granted by a pass tier (credit)
  'store-spend', // spent in the cosmetic store (debit)
  'refund', // reversal (credit)
]);
export type SparkReason = z.infer<typeof SparkReason>;

/** One immutable ledger entry. `amount` is positive for a credit, negative for a debit. */
export const SparkLedgerEntry = z.object({
  entryId: z.string().min(1),
  playerId: z.string().min(1),
  amount: z.number().int(),
  reason: SparkReason,
  ts: z.number().int().nonnegative(),
  /** Free-form link to the cause (orderId, adId, tier, cosmeticId). */
  ref: z.string().default(''),
});
export type SparkLedgerEntry = z.infer<typeof SparkLedgerEntry>;

/** Derive a player's spark balance by folding their ledger. Balance = sum of amounts; never negative. */
export function sparkBalance(entries: readonly SparkLedgerEntry[]): number {
  return entries.reduce((sum, e) => sum + e.amount, 0);
}

/** Whether a debit of `cost` sparks is affordable given the current ledger (no overdraft). */
export function canAfford(entries: readonly SparkLedgerEntry[], cost: number): boolean {
  return sparkBalance(entries) >= cost;
}
