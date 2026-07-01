import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ArenaView } from './sceneModel.js';

/**
 * Arena Pixi scene (P0-C-2 / OOM-18).
 *
 * Draws the four scene elements OOM-18 calls for — background, boss sprite, HP bar, phase label —
 * and exposes `update(view)` / `layout(w, h)` so the pure view-model (`sceneModel.ts`) and the caller
 * drive it. This is the thin render layer (indication `client-screens-pure-and-testable`): no game
 * logic lives here. WebGL is unavailable in jsdom, so it is verified by typecheck + build, not units.
 *
 * The boss "sprite" is a procedural Graphics placeholder — no art pipeline exists yet in P0.
 */

export interface ArenaScene {
  /** Apply the latest view-model (HP fraction/text, phase label). */
  update(view: ArenaView): void;
  /** Re-layout for a new canvas size (call on resize). */
  layout(width: number, height: number): void;
  destroy(): void;
}

const BAR_HEIGHT = 22;
const BAR_TOP = 48;
const TEXT_FILL = '#e6edf3';

/** Green → amber → red as the boss weakens, so the bar reads at a glance. */
function hpColor(fraction: number): number {
  if (fraction > 0.5) return 0x3fb950;
  if (fraction > 0.2) return 0xd29922;
  return 0xda3633;
}

/** Procedural placeholder boss, drawn centred on its own origin so it can be positioned by anchor. */
function createBossSprite(): Container {
  const boss = new Container();

  const body = new Graphics();
  body.ellipse(0, 0, 90, 70).fill(0x8957e5);
  body.ellipse(0, 0, 90, 70).stroke({ width: 4, color: 0xbc8cff });

  const eyeL = new Graphics().circle(-32, -12, 14).fill(0x0e1116);
  const eyeR = new Graphics().circle(32, -12, 14).fill(0x0e1116);
  const glintL = new Graphics().circle(-28, -16, 4).fill(0xffffff);
  const glintR = new Graphics().circle(36, -16, 4).fill(0xffffff);
  const mouth = new Graphics().roundRect(-30, 24, 60, 12, 6).fill(0x0e1116);

  boss.addChild(body, eyeL, eyeR, glintL, glintR, mouth);
  return boss;
}

export function createArenaScene(app: Application): ArenaScene {
  const root = new Container();
  app.stage.addChild(root);

  const background = new Graphics();
  const boss = createBossSprite();
  const hpBarBg = new Graphics();
  const hpBarFill = new Graphics();
  const hpBarBorder = new Graphics();

  const hpText = new Text({
    text: '',
    style: { fill: TEXT_FILL, fontFamily: 'system-ui', fontSize: 13 },
  });
  hpText.anchor.set(0.5);

  const phaseText = new Text({
    text: '',
    style: { fill: TEXT_FILL, fontFamily: 'system-ui', fontSize: 22, fontWeight: 'bold' },
  });
  phaseText.anchor.set(0.5);

  root.addChild(background, boss, hpBarBg, hpBarFill, hpBarBorder, phaseText, hpText);

  let width = app.screen.width;
  let height = app.screen.height;
  let view: ArenaView = { hpFraction: 1, hpText: '', phaseLabel: '', phaseProgressPct: 0 };

  const barMetrics = (): { barW: number; x: number; y: number } => {
    const barW = Math.min(560, width * 0.7);
    return { barW, x: (width - barW) / 2, y: BAR_TOP };
  };

  const redraw = (): void => {
    // Background: dark backdrop + a lighter floor band.
    const floorY = height * 0.72;
    background.clear();
    background.rect(0, 0, width, height).fill(0x0e1116);
    background.rect(0, floorY, width, height - floorY).fill(0x161b22);

    // Boss, centred in the upper-middle, scaled gently with viewport width.
    boss.position.set(width / 2, height * 0.46);
    const scale = Math.min(1.4, Math.max(0.6, width / 900));
    boss.scale.set(scale);

    // HP bar: track, fill (scaled by fraction), border.
    const { barW, x, y } = barMetrics();
    hpBarBg.clear().roundRect(x, y, barW, BAR_HEIGHT, 6).fill(0x21262d);

    hpBarFill.clear();
    const fillW = barW * view.hpFraction;
    if (fillW > 0) hpBarFill.roundRect(x, y, fillW, BAR_HEIGHT, 6).fill(hpColor(view.hpFraction));

    hpBarBorder.clear().roundRect(x, y, barW, BAR_HEIGHT, 6).stroke({ width: 2, color: 0x30363d });

    hpText.text = view.hpText;
    hpText.position.set(width / 2, y + BAR_HEIGHT / 2);

    phaseText.text = view.phaseLabel;
    phaseText.position.set(width / 2, y - 16);
  };

  redraw();

  return {
    update(next: ArenaView): void {
      view = next;
      redraw();
    },
    layout(nextWidth: number, nextHeight: number): void {
      width = nextWidth;
      height = nextHeight;
      redraw();
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}
