import { createLogger, capture } from '@overworld/shared';
import { getOrCreateSession, type KVStorage, type Session } from './session.js';
import { createScreenController, type Screen } from './screens.js';
import { renderLanding } from './ui/landing.js';
import { mountArena } from './ui/arena.js';

export interface AppDeps {
  storage: KVStorage;
  /** Injectable clock for deterministic time-to-arena measurement in tests. */
  now?: () => number;
  /**
   * Called with the arena canvas element and the joined session once the arena mounts. The real entry
   * passes Pixi's `createArena` here (using `session.playerId` as the contribution identity, OOM-20);
   * tests leave it undefined so `app.ts` stays browser-free (OOM-17 seam).
   */
  onArenaMount?: (canvas: HTMLElement, session: Session) => void;
}

export interface App {
  readonly screen: Screen;
  /** ms from Join click to arena mounted; null until joined. */
  readonly joinDurationMs: number | null;
  readonly session: Session | null;
}

/**
 * Wire the landing -> arena flow (P0-C-0 / OOM-16).
 *
 * On Join: issue/reuse the anonymous token, "connect" (a local no-op in P0 — real WS connect is
 * OOM-32), mount the arena, and record how long it took. That duration is the measurable proxy for
 * the P0 "<1s to first contribution" target until the contribution action lands (OOM-19).
 */
export function startApp(root: HTMLElement, deps: AppDeps): App {
  const logger = createLogger('client', 'debug');
  const now = deps.now ?? (() => performance.now());

  let session: Session | null = null;
  let joinDurationMs: number | null = null;
  const screens = createScreenController();

  const onJoin = (): void => {
    const started = now();
    session = getOrCreateSession(deps.storage);
    // P0 is client-only: "connect" is a local no-op. Real WS connect arrives in OOM-32.
    screens.join();
    const canvas = mountArena(root, session);
    deps.onArenaMount?.(canvas, session);
    joinDurationMs = now() - started;
    logger.info('joined arena', { playerId: session.playerId, joinDurationMs });
    capture('join_the_fight', { joinDurationMs });
  };

  renderLanding(root, onJoin);

  return {
    get screen() {
      return screens.current;
    },
    get joinDurationMs() {
      return joinDurationMs;
    },
    get session() {
      return session;
    },
  };
}
