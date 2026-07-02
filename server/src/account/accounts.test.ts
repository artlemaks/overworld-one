import { describe, it, expect } from 'vitest';
import { createAccountService, type AccountServiceOptions } from './accounts.js';

const SESSION_TTL = 60_000;

function harness(startTs = 1_000_000) {
  let t = startTs;
  let idN = 0;
  let tokN = 0;
  const opts: AccountServiceOptions = {
    now: () => t,
    genId: () => `player-${++idN}`,
    genToken: () => `token-${++tokN}`,
    sessionTtlMs: SESSION_TTL,
  };
  const svc = createAccountService(opts);
  return { svc, setNow: (v: number) => (t = v) };
}

describe('createAccountService', () => {
  it('registerDevice mints an anonymous account and a valid fresh session', () => {
    const { svc } = harness();
    const { account, session } = svc.registerDevice();

    expect(account.kind).toBe('anonymous');
    expect(account.email).toBeNull();
    expect(account.playerId).toBe('player-1');
    expect(account.createdAtTs).toBe(1_000_000);
    expect(account.lastSeenTs).toBe(1_000_000);

    expect(session.playerId).toBe('player-1');
    expect(session.issuedAtTs).toBe(1_000_000);
    expect(session.expiresAtTs).toBe(1_000_000 + SESSION_TTL);

    const verified = svc.verifySession(session.token);
    expect(verified).toEqual({ valid: true, playerId: 'player-1' });
  });

  it('verifySession rejects an unknown token', () => {
    const { svc } = harness();
    expect(svc.verifySession('nope')).toEqual({ valid: false, reason: 'unknown' });
  });

  it('verifySession rejects an expired token', () => {
    const { svc, setNow } = harness();
    const { session } = svc.registerDevice();

    setNow(1_000_000 + SESSION_TTL - 1);
    expect(svc.verifySession(session.token).valid).toBe(true);

    setNow(1_000_000 + SESSION_TTL); // exactly at expiry is expired
    expect(svc.verifySession(session.token)).toEqual({ valid: false, reason: 'expired' });
  });

  it('issueSession re-mints a session for an existing player and throws for unknown', () => {
    const { svc, setNow } = harness();
    const { account } = svc.registerDevice();

    setNow(1_050_000);
    const reissued = svc.issueSession(account.playerId);
    expect(reissued.playerId).toBe(account.playerId);
    expect(reissued.issuedAtTs).toBe(1_050_000);
    expect(reissued.expiresAtTs).toBe(1_050_000 + SESSION_TTL);
    expect(svc.verifySession(reissued.token).valid).toBe(true);

    expect(() => svc.issueSession('ghost')).toThrow(/unknown player/);
  });

  it('touch updates lastSeenTs and is a no-op for unknown players', () => {
    const { svc, setNow } = harness();
    const { account } = svc.registerDevice();
    expect(svc.getAccount(account.playerId)?.lastSeenTs).toBe(1_000_000);

    setNow(1_200_000);
    svc.touch(account.playerId);
    expect(svc.getAccount(account.playerId)?.lastSeenTs).toBe(1_200_000);

    expect(() => svc.touch('ghost')).not.toThrow();
  });

  it('getAccount returns null for unknown players', () => {
    const { svc } = harness();
    expect(svc.getAccount('ghost')).toBeNull();
  });
});
