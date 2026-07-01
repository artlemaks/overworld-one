import { Application, Text } from 'pixi.js';
import { createLogger } from '@overworld/shared';
import { createFixedLoop } from './loop.js';

/**
 * Pixi bootstrap (P0-C-1 / OOM-17).
 *
 * Initialises a Pixi Application inside the arena mount (`#arena-canvas` from OOM-16), wires a
 * responsive canvas (`resizeTo` the mount) and a fixed-timestep loop driven by the Pixi ticker.
 * The scene is a placeholder label — the real arena (boss, HP bar) lands in OOM-18.
 *
 * Not unit-tested (WebGL is unavailable in jsdom); verified by typecheck + build + runtime.
 */
export interface Arena {
  destroy(): void;
}

const LOGIC_HZ = 60;

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

  const label = new Text({
    text: 'Arena online',
    style: { fill: '#e6edf3', fontFamily: 'system-ui', fontSize: 28 },
  });
  label.anchor.set(0.5);
  const center = (): void => {
    label.position.set(app.screen.width / 2, app.screen.height / 2);
  };
  center();
  app.stage.addChild(label);
  app.renderer.on('resize', center);

  // Fixed 60 Hz simulation, fed by the variable-rate render ticker.
  const loop = createFixedLoop({
    stepMs: 1000 / LOGIC_HZ,
    update: () => {
      // Placeholder tick — boss state / input integration arrives in OOM-18/19.
    },
  });
  app.ticker.add((ticker) => loop.advance(ticker.deltaMS));

  logger.info('arena initialized', {
    width: Math.round(app.screen.width),
    height: Math.round(app.screen.height),
  });

  return {
    destroy() {
      app.destroy(true, { children: true });
    },
  };
}
