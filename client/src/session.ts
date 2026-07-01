/**
 * Anonymous session / token (P0-C-0 / OOM-16).
 *
 * P0 is client-only, so the token is generated and persisted locally. The `playerId` it carries is
 * the same identity the shared `ContributionMessage` uses — so when P4 (OOM-57) swaps this for a
 * server-issued device token, nothing downstream changes shape.
 */

/** Minimal storage surface — satisfied by `localStorage`; a Map-backed stub is used in tests. */
export interface KVStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface Session {
  playerId: string;
  createdAt: number;
}

const STORAGE_KEY = 'ow.session';

/** Default id generator — browser + Node 20 both expose `crypto.randomUUID`. */
function defaultGenId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // Fallback for exotic environments: timestamp + random suffix (not for security).
  return `anon-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function isSession(value: unknown): value is Session {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Session).playerId === 'string' &&
    (value as Session).playerId.length > 0 &&
    typeof (value as Session).createdAt === 'number'
  );
}

/**
 * Return the persisted session, creating + storing one if absent or corrupt.
 * Idempotent: a returning player keeps the same `playerId`.
 */
export function getOrCreateSession(
  storage: KVStorage,
  genId: () => string = defaultGenId,
  now: () => number = Date.now,
): Session {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isSession(parsed)) return parsed;
    } catch {
      // fall through and regenerate on corrupt JSON
    }
  }
  const session: Session = { playerId: genId(), createdAt: now() };
  storage.setItem(STORAGE_KEY, JSON.stringify(session));
  return session;
}
