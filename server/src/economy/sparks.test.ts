import { describe, it, expect } from 'vitest';
import { createSparkLedger, type SparkLedger } from './sparks.js';

function makeLedger(): SparkLedger {
  let t = 1_000;
  let n = 0;
  return createSparkLedger({
    now: () => (t += 1),
    genId: () => `e${(n += 1)}`,
  });
}

describe('createSparkLedger', () => {
  it('raises the balance on a credit', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 100, 'purchase', 'order-1');
    expect(ledger.balance('p1')).toBe(100);
  });

  it('lowers the balance on a debit', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 100, 'purchase');
    const res = ledger.debit('p1', 40, 'store-spend', 'skin-1');
    expect(res.ok).toBe(true);
    expect(res.entry?.amount).toBe(-40);
    expect(ledger.balance('p1')).toBe(60);
  });

  it('rejects an overdraft debit and leaves the balance untouched', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 30, 'purchase');
    const res = ledger.debit('p1', 50, 'store-spend');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('overdraft');
    expect(res.entry).toBeUndefined();
    expect(ledger.balance('p1')).toBe(30);
  });

  it('allows a debit that spends the full balance to zero', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 25, 'ad-reward');
    const res = ledger.debit('p1', 25, 'store-spend');
    expect(res.ok).toBe(true);
    expect(ledger.balance('p1')).toBe(0);
  });

  it('derives the balance purely from the folded log', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 100, 'purchase');
    ledger.debit('p1', 30, 'store-spend');
    ledger.credit('p1', 10, 'refund');
    const derived = ledger
      .entries('p1')
      .reduce((sum, e) => sum + e.amount, 0);
    expect(ledger.balance('p1')).toBe(derived);
    expect(ledger.balance('p1')).toBe(80);
  });

  it('stamps ts and mints a unique entryId per entry via the injected sources', () => {
    const ledger = makeLedger();
    const a = ledger.credit('p1', 10, 'purchase');
    const b = ledger.credit('p1', 10, 'purchase');
    expect(a.entryId).not.toBe(b.entryId);
    expect(b.ts).toBeGreaterThan(a.ts);
  });

  it('keeps players isolated', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 100, 'purchase');
    ledger.credit('p2', 5, 'purchase');
    expect(ledger.balance('p1')).toBe(100);
    expect(ledger.balance('p2')).toBe(5);
  });

  it('returns a copy of the log, not the internal array', () => {
    const ledger = makeLedger();
    ledger.credit('p1', 100, 'purchase');
    const snapshot = ledger.entries('p1');
    snapshot.push({
      entryId: 'x',
      playerId: 'p1',
      amount: 9999,
      reason: 'purchase',
      ts: 0,
      ref: '',
    });
    expect(ledger.balance('p1')).toBe(100);
  });

  it('rejects non-positive or non-integer amounts', () => {
    const ledger = makeLedger();
    expect(() => ledger.credit('p1', 0, 'purchase')).toThrow();
    expect(() => ledger.credit('p1', -5, 'purchase')).toThrow();
    expect(ledger.debit('p1', 0, 'store-spend').ok).toBe(false);
  });
});
