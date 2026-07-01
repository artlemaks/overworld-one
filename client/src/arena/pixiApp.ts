import { Application } from 'pixi.js';
import { createLogger } from '@overworld/shared';
import { createFixedLoop } from './loop.js';
import { createArenaScene } from './scene.js';
import { toArenaView } from './sceneModel.js';
import { createMockEvent } from './mockEvent.js';

/**
 * Pixi bootstrap + arena scene (P0-C-1 / OOM-17, P0-C-2 / OOM-18).
 *
 * Initialises a Pixi Application inside the arena mount (`#arena-canvas` from OOM-16), wires a
 * responsive canvas (`resizeTo` the mount) and a fixed-timestep loop driven by the Pixi ticker.
 * OOM-18 mounts the real scene — boss sprite, HP bar, phase label, background — driven by a
 * deterministic mock event until the server tick stream lands (OOM-32).
 *
 * Not unit-tested (WebGL is unavailable in jsdom); verified by typecheck + build + runtime. The
 * testable pieces live in `sceneModel.ts` / `mockEvent.ts`.
 */
export interface Arena {
  destroy(): void;
}

const LOGIC_HZ = 60;
const BOSS_HP_MAX = 1000;

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

  const applyState = (): void => {
    scene.update(toArenaView(event.state(), BOSS_HP_MAX));
  };
  applyState();

  const relayout = (): void => {
    scene.layout(app.screen.width, app.screen.height);
    applyState();
  };
  app.renderer.on('resize', relayout);

  // Fixed 60 Hz simulation feeds the mock event; render reflects the latest state each frame.
  const loop = createFixedLoop({
    stepMs: 1000 / LOGIC_HZ,
    update: (stepMs) => {
      event.advance(stepMs);
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
      scene.destroy();
      app.destroy(true, { children: true });
    },
  };
}
