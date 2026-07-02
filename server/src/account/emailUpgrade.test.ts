import { describe, it, expect } from 'vitest';
import { createEmailUpgradeService, type EmailUpgradeOptions } from './emailUpgrade.js';

const LINK_TTL = 15 * 60_000;

function harness(startTs = 2_000_000) {
  let t = startTs;
  let idN = 0;
  const opts: EmailUpgradeOptions = {
    now: () => t,
    genId: () => `link-${++idN}`,
    linkTtlMs: LINK_TTL,
  };
  const svc = createEmailUpgradeService(opts);
  const applied: Array<{ playerId: string; email: string }> = [];
  const applyToAccount = (playerId: string, email: string) => applied.push({ playerId, email });
  return { svc, applied, applyToAccount, setNow: (v: number) => (t = v) };
}

describe('createEmailUpgradeService', () => {
  it('beginUpgrade issues an unconsumed, expiring challenge for the stable playerId', () => {
    const { svc } = harness();
    const challenge = svc.beginUpgrade('player-1', 'a@b.com');
    expect(challenge.linkId).toBe('link-1');
    expect(challenge.playerId).toBe('player-1');
    expect(challenge.email).toBe('a@b.com');
    expect(challenge.consumed).toBe(false);
    expect(challenge.issuedAtTs).toBe(2_000_000);
    expect(challenge.expiresAtTs).toBe(2_000_000 + LINK_TTL);
  });

  it('completeUpgrade happy path flips the account, preserving the playerId', () => {
    const { svc, applied, applyToAccount } = harness();
    const challenge = svc.beginUpgrade('player-1', 'a@b.com');

    const result = svc.completeUpgrade(challenge.linkId, applyToAccount);
    expect(result).toEqual({ ok: true });
    expect(applied).toEqual([{ playerId: 'player-1', email: 'a@b.com' }]);
  });

  it('rejects an unknown link', () => {
    const { svc, applyToAccount, applied } = harness();
    expect(svc.completeUpgrade('nope', applyToAccount)).toEqual({ ok: false, reason: 'unknown' });
    expect(applied).toHaveLength(0);
  });

  it('rejects an expired link without applying', () => {
    const { svc, applyToAccount, applied, setNow } = harness();
    const challenge = svc.beginUpgrade('player-1', 'a@b.com');

    setNow(2_000_000 + LINK_TTL); // exactly at expiry is expired
    expect(svc.completeUpgrade(challenge.linkId, applyToAccount)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(applied).toHaveLength(0);
  });

  it('is single-use — a second completion is rejected as consumed and does not re-apply', () => {
    const { svc, applied, applyToAccount } = harness();
    const challenge = svc.beginUpgrade('player-1', 'a@b.com');

    expect(svc.completeUpgrade(challenge.linkId, applyToAccount).ok).toBe(true);
    expect(svc.completeUpgrade(challenge.linkId, applyToAccount)).toEqual({
      ok: false,
      reason: 'consumed',
    });
    expect(applied).toHaveLength(1);
  });
});
