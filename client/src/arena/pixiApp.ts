import { Application } from 'pixi.js';
import { createLogger } from '@overworld/shared';
import { createFixedLoop } from './loop.js';
import { createArenaScene } from './scene.js';
import { toArenaView } from './sceneModel.js';
import { createMockEvent } from './mockEvent.js';
import { createInputBuffer } from './input.js';
import { attachPointerInput } from './pointerInput.js';
import { createStrikeTiming, resolveStrike, type StrikeInput } from './contribution.js';
import { scoreStrike } from './scoring.js';

/**
 * Pixi bootstrap + arena scene + contribution action (P0-C-1/2/3/4 · OOM-17–20).
 *
 * Initialises a Pixi Application inside the arena mount (`#arena-canvas` from OOM-16), wires a
 * responsive canvas (`resizeTo` the mount) and a fixed-timestep loop driven by the Pixi ticker.
 * OOM-18 mounts the real scene — boss sprite, HP bar, phase label, background — driven by a
 * deterministic mock event until the server tick stream lands (OOM-32). OOM-19 adds the aim-and-strike
 * action: pointer/touch input is buffered and drained on the fixed step, then resolved against the
 * boss centre and the timing beat. OOM-20 maps each resolved strike into the shared
 * `ContributionMessage` plus a provisional local score (both non-authoritative — the server owns
 * scoring in P1).
 *
 * Not unit-tested (WebGL is unavailable in jsdom); verified by typecheck + build + runtime. The
 * testable pieces live in `sceneModel.ts` / `mockEvent.ts` / `scoring.ts`.
 */
export interface Arena {
  destroy(): void;
}

export interface CreateArenaOptions {
  /** Wire identity for contributions (session token). Defaults to a local anon id in dev. */
  playerId?: string;
}

const LOGIC_HZ = 60;
const BOSS_HP_MAX = 1000;
/** Strike rhythm: a beat roughly every 900ms with a 300ms scoring window (OOM-19). */
const BEAT_PERIOD_MS = 900;
const BEAT_WINDOW_MS = 300;

export async function createArena(
  mount: HTMLElement,
  options: CreateArenaOptions = {},
): Promise<Arena> {
  const logger = createLogger('arena', 'debug');
  const playerId = options.playerId ?? 'local-anon';

  const app = new Application();
  await app.init({
    resizeTo: mount,
    background: '#0e1116',
    antialias: true,
    autoDensity: true,
    resolution: globalThis.devicePixelRatio || 1,
  });

  // Swap the placeholder text for the live canvas.
  mount.replaceChildren(app.canvas);

  const scene = createArenaScene(app);
  const event = createMockEvent({ hpMax: BOSS_HP_MAX });

  // Contribution action (OOM-19): pointer/touch → buffer → per-step drain → aim-and-strike resolve.
  const inputBuffer = createInputBuffer<StrikeInput>();
  const pointer = attachPointerInput(app, inputBuffer);
  const timing = createStrikeTiming({ periodMs: BEAT_PERIOD_MS, windowMs: BEAT_WINDOW_MS });

  const applyState = (): void => {
    scene.update(toArenaView(event.state(), BOSS_HP_MAX));
    scene.setBeat(timing.phase());
  };
  applyState();

  const relayout = (): void => {
    scene.layout(app.screen.width, app.screen.height);
    applyState();
  };
  app.renderer.on('resize', relayout);

  // Running local tally — a provisional P0 feel signal; the server owns the real total in P1.
  let localScoreTotal = 0;

  // Drain buffered inputs at the fixed step so consumption is deterministic and none are lost.
  const consumeStrikes = (): void => {
    for (const input of inputBuffer.drain()) {
      const strike = resolveStrike(input, {
        bossCenter: scene.bossCenter(),
        aimRadius: scene.strikeRadius(),
        timingQuality: timing.quality(),
      });
      scene.markStrike(input.point, strike.accuracy);
      // OOM-20: shape the strike into the shared wire contract + a provisional local score. The
      // server computes the authoritative value (P1-S-3); `message` is what OOM-32's netcode will send.
      const { message, localScore } = scoreStrike(strike, playerId);
      localScoreTotal += localScore;
      logger.debug('contribution', {
        actionType: message.actionType,
        accuracy: Number(strike.accuracy.toFixed(2)),
        localScore,
        localScoreTotal,
      });
    }
  };

  // Fixed 60 Hz simulation feeds the mock event + beat + strike ingest; render reflects it each frame.
  const loop = createFixedLoop({
    stepMs: 1000 / LOGIC_HZ,
    update: (stepMs) => {
      event.advance(stepMs);
      timing.advance(stepMs);
      consumeStrikes();
    },
    render: applyState,
  });
  app.ticker.add((ticker) => loop.advance(ticker.deltaMS));

  logger.info('arena initialized', {
    width: Math.round(app.screen.width),
    height: Math.round(app.screen.height),
  });

  return {
    destroy() {
      app.renderer.off('resize', relayout);
      pointer.destroy();
      scene.destroy();
      app.destroy(true, { children: true });
    },
  };
}
