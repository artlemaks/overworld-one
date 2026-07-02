import { describe, it, expect } from 'vitest';
import { SparkLedgerEntry, sparkBalance, canAfford } from './currency.js';

const entry = (amount: number, reason: SparkLedgerEntry['reason'], id: string): SparkLedgerEntry =>
  SparkLedgerEntry.parse({ entryId: id, playerId: 'p1', amount, reason, ts: 0 });

describe('sparks ledger', () => {
  it('derives balance as the sum of the append-only log', () => {
    const log = [entry(500, 'purchase', 'e1'), entry(-200, 'store-spend', 'e2'), entry(50, 'ad-reward', 'e3')];
    expect(sparkBalance(log)).toBe(350);
  });

  it('an empty ledger is a zero balance', () => {
    expect(sparkBalance([])).toBe(0);
  });

  it('affordability respects the derived balance (no overdraft)', () => {
    const log = [entry(300, 'purchase', 'e1')];
    expect(canAfford(log, 300)).toBe(true);
    expect(canAfford(log, 301)).toBe(false);
  });
});
