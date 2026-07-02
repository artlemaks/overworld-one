import {
  type SparkLedgerEntry,
  type SparkReason,
  sparkBalance,
  canAfford,
} from '@overworld/shared';

/**
 * Sparks ledger service (P4-D-2 / OOM-26).
 *
 * A stateful facade over the shared append-only sparks ledger: it keeps a per-player log of immutable
 * {@link SparkLedgerEntry} records and derives every balance by folding that log through the shared
 * {@link sparkBalance} — the balance is never a stored mutable field, so it can never drift from its
 * history. Credits (`purchase`, `ad-reward`, `pass-grant`, `refund`) add sparks; debits (`store-spend`)
 * remove them and are rejected on overdraft via the shared {@link canAfford} guard.
 *
 * **Cosmetics only, never power (P4-X-1).** Sparks buy cosmetic/commemorative items; nothing in this
 * service touches the shared power bar.
 *
 * Pure of wall-clock and I/O: the caller injects `now` (to stamp `ts`) and `genId` (to mint each unique,
 * dedup-friendly `entryId`). Storage is an in-process per-player {@link Map} — durable persistence
 * (Postgres/Redis, cross-node) is future work and slots behind this same interface without changing
 * callers. (Idempotent replay by a caller-supplied `entryId` is likewise deferred; here every append
 * mints a fresh id via `genId`.)
 */

export interface SparkLedgerOptions {
  /** Injectable clock (epoch ms) — stamps each entry's `ts`. */
  now: () => number;
  /** Injectable entry-id source (opaque, unique) — mints each entry's `entryId`. */
  genId: () => string;
}

/** The result of an attempted debit. `ok` false means the spend was rejected (e.g. overdraft). */
export interface DebitResult {
  ok: boolean;
  /** The recorded entry, present when `ok`. */
  entry?: SparkLedgerEntry;
  /** Why the debit was rejected (`overdraft` | `invalid-amount`), present when not `ok`. */
  reason?: string;
}

export interface SparkLedger {
  /** Add `amount` (> 0) sparks for a player; returns the recorded credit entry. */
  credit(playerId: string, amount: number, reason: SparkReason, ref?: string): SparkLedgerEntry;
  /** Spend `cost` (> 0) sparks; rejected via the shared overdraft guard if unaffordable. */
  debit(playerId: string, cost: number, reason: SparkReason, ref?: string): DebitResult;
  /** A player's current balance, derived by folding their log. */
  balance(playerId: string): number;
  /** A player's ordered ledger (a copy — the internal log is never handed out mutable). */
  entries(playerId: string): SparkLedgerEntry[];
}

export function createSparkLedger(opts: SparkLedgerOptions): SparkLedger {
  /** Per-player append-only log. In-memory; persistence is future work (see module JSDoc). */
  const logs = new Map<string, SparkLedgerEntry[]>();

  const logFor = (playerId: string): SparkLedgerEntry[] => {
    let log = logs.get(playerId);
    if (log === undefined) {
      log = [];
      logs.set(playerId, log);
    }
    return log;
  };

  const append = (
    playerId: string,
    amount: number,
    reason: SparkReason,
    ref: string,
  ): SparkLedgerEntry => {
    const entry: SparkLedgerEntry = {
      entryId: opts.genId(),
      playerId,
      amount,
      reason,
      ts: opts.now(),
      ref,
    };
    logFor(playerId).push(entry);
    return entry;
  };

  return {
    credit(playerId, amount, reason, ref = '') {
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new Error(`credit amount must be a positive integer, got ${amount}`);
      }
      return append(playerId, amount, reason, ref);
    },

    debit(playerId, cost, reason, ref = '') {
      if (!Number.isInteger(cost) || cost <= 0) {
        return { ok: false, reason: 'invalid-amount' };
      }
      const log = logFor(playerId);
      if (!canAfford(log, cost)) {
        return { ok: false, reason: 'overdraft' };
      }
      return { ok: true, entry: append(playerId, -cost, reason, ref) };
    },

    balance(playerId) {
      return sparkBalance(logFor(playerId));
    },

    entries(playerId) {
      return [...logFor(playerId)];
    },
  };
}
