import { describe, it, expect } from 'vitest';
import { createNameModerator } from './nameFilter.js';

describe('createNameModerator — proposeName', () => {
  it('accepts and records a clean name', () => {
    const mod = createNameModerator();
    const res = mod.proposeName('p1', '  Aria  ');
    expect(res.ok).toBe(true);
    expect(res.reason).toBeUndefined();
    // Recorded trimmed.
    expect(mod.nameOf('p1')).toBe('Aria');
  });

  it('rejects a blocklisted name and records nothing', () => {
    const mod = createNameModerator();
    const res = mod.proposeName('p1', 'the-admin');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('blocked-word');
    expect(mod.nameOf('p1')).toBeUndefined();
  });

  it('rejects too-short and too-long names', () => {
    const mod = createNameModerator();
    expect(mod.proposeName('p1', 'a').reason).toBe('too-short');
    expect(mod.proposeName('p2', 'x'.repeat(21)).reason).toBe('too-long');
    expect(mod.nameOf('p1')).toBeUndefined();
    expect(mod.nameOf('p2')).toBeUndefined();
  });

  it('keeps the prior accepted name when a later proposal is rejected', () => {
    const mod = createNameModerator();
    expect(mod.proposeName('p1', 'Aria').ok).toBe(true);
    expect(mod.proposeName('p1', 'a').ok).toBe(false);
    expect(mod.nameOf('p1')).toBe('Aria');
  });
});

describe('createNameModerator — validateBroadcast', () => {
  it('accepts a curated cheer', () => {
    const mod = createNameModerator();
    expect(mod.validateBroadcast('lets-go')).toEqual({ ok: true });
  });

  it('rejects free-text tokens', () => {
    const mod = createNameModerator();
    expect(mod.validateBroadcast('hello world').ok).toBe(false);
    expect(mod.validateBroadcast('').ok).toBe(false);
  });
});
