import { Application } from 'pixi.js';
import { createLogger } from '@overworld/shared';
import { createFixedLoop } from './loop.js';
import { createArenaScene } from './scene.js';
import { toArenaView } from './sceneModel.js';
import { createMockEvent } from './mockEvent.js';
import { createInputBuffer } from './input.js';
import { attachPointerInput } from './pointerInput.js';
import { createStrikeTiming, resolveStrike, type StrikeInput } from './contribution.js';

/**
 * Pixi bootstrap + arena scene + contribution action (P0-C-1/2/3 · OOM-17, OOM-18, OOM-19).
 *
 * Initialises a Pixi Application inside the arena mount (`#arena-canvas` from OOM-16), wires a
 * responsive canvas (`resizeTo` the mount) and a fixed-timestep loop driven by the Pixi ticker.
 * OOM-18 mounts the real scene — boss sprite, HP bar, phase label, background — driven by a
 * deterministic mock event until the server tick stream lands (OOM-32). OOM-19 adds the aim-and-strike
 * action: pointer/touch input is buffered and drained on the fixed step, then resolved against the
 * boss centre and the timing beat (scoring stays server-side; the local placeholder is OOM-20).
 *
 * Not unit-tested (WebGL is unavailable in jsdom); verified by typecheck + build + runtime. The
 * testable pieces live in `sceneModel.ts` / `mockEvent.ts`.
 */
export interface Arena {
  destroy(): void;
}

const LOGIC_HZ = 60;
const BOSS_HP_MAX = 1000;
/** Strike rhythm: a beat roughly every 900ms with a 300ms scoring window (OOM-19). */
const BEAT_PERIOD_MS = 900;
const BEAT_WINDOW_MS = 300;

export async function createArena(mount: HTMLElement): Promise<Arena> {
  const logger = createLogger('arena', 'debug');

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

  // Drain buffered inputs at the fixed step so consumption is deterministic and none are lost.
  const consumeStrikes = (): void => {
    for (const input of inputBuffer.drain()) {
      const strike = resolveStrike(input, {
        bossCenter: scene.bossCenter(),
        aimRadius: scene.strikeRadius(),
        timingQuality: timing.quality(),
      });
      scene.markStrike(input.point, strike.accuracy);
      // Scoring is deliberately out of scope here — the value is computed server-side (P1-S-3);
      // the P0 local placeholder that maps this into ContributionMessage.inputParams lands in OOM-20.
      logger.debug('strike', {
        aimAccuracy: Number(strike.aimAccuracy.toFixed(2)),
        timingQuality: Number(strike.timingQuality.toFixed(2)),
        accuracy: Number(strike.accuracy.toFixed(2)),
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
