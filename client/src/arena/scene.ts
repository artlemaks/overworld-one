import { Application, Container, Graphics, Text } from 'pixi.js';
import type { ArenaView } from './sceneModel.js';
import type { Vec2 } from './contribution.js';
import type { ShakeOffset, FloatingItem, ParticleItem } from './juice.js';

/**
 * Arena Pixi scene (P0-C-2/5 · OOM-18, OOM-21).
 *
 * Draws the scene elements OOM-18 calls for — background, boss sprite, HP bar, phase label — and the
 * OOM-21 feedback juice — floating number pops, particle bursts, and camera shake (applied to a
 * "world" layer so the UI/background stay put). It exposes `update(view)` / `layout(w, h)` plus juice
 * render hooks so the pure modules (`sceneModel.ts`, `juice.ts`) and the caller drive it. This is the
 * thin render layer (indication `client-screens-pure-and-testable`): no game logic lives here. WebGL
 * is unavailable in jsdom, so it is verified by typecheck + build, not units.
 *
 * The boss "sprite" is a procedural Graphics placeholder — no art pipeline exists yet in P0.
 */

export interface ArenaScene {
  /** Apply the latest view-model (HP fraction/text, phase label). */
  update(view: ArenaView): void;
  /** Re-layout for a new canvas size (call on resize). */
  layout(width: number, height: number): void;
  /** Centre of the boss in screen space — where strikes are aimed (OOM-19). */
  bossCenter(): Vec2;
  /** Radius (px) at which aim accuracy reaches zero — the forgiving P0 aim ring (OOM-19). */
  strikeRadius(): number;
  /** Pulse the timing-beat ring; `phase` in [0,1) through the current beat (OOM-19). */
  setBeat(phase: number): void;
  /** Mark where the last strike landed; `accuracy` in [0,1] tints it (OOM-19). */
  markStrike(point: Vec2, accuracy: number): void;
  /** Offset/rotate the world layer for camera shake (OOM-21). */
  applyShake(offset: ShakeOffset): void;
  /** Draw the current particle set (OOM-21). */
  drawParticles(items: ParticleItem[]): void;
  /** Draw the current floating-text pops (OOM-21). */
  drawFloaters(items: FloatingItem[]): void;
  destroy(): void;
}

const BAR_HEIGHT = 22;
const BAR_TOP = 48;
const TEXT_FILL = '#e6edf3';
/** Aim ring radius as a fraction of the smaller viewport dimension — forgiving on mobile (OOM-19). */
const STRIKE_RADIUS_FRACTION = 0.4;
/** Reused Text objects for number pops — a fixed pool avoids per-frame allocation (OOM-21). */
const FLOATER_POOL = 24;

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
  // The world layer holds everything that shakes; background + UI stay outside it.
  const world = new Container();
  const beatRing = new Graphics();
  const boss = createBossSprite();
  const particlesGfx = new Graphics();
  const strikeMark = new Graphics();
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

  // Number-pop pool: pre-created, shown/hidden per frame from drawFloaters().
  const floaters: Text[] = [];
  for (let i = 0; i < FLOATER_POOL; i++) {
    const t = new Text({
      text: '',
      style: { fill: '#ffffff', fontFamily: 'system-ui', fontSize: 20, fontWeight: 'bold' },
    });
    t.anchor.set(0.5);
    t.visible = false;
    floaters.push(t);
  }

  // beatRing behind the boss (pulses around it); strikeMark + particles + floaters above it.
  world.addChild(beatRing, boss, strikeMark, particlesGfx, ...floaters);
  root.addChild(background, world, hpBarBg, hpBarFill, hpBarBorder, phaseText, hpText);

  let width = app.screen.width;
  let height = app.screen.height;
  let view: ArenaView = { hpFraction: 1, hpText: '', phaseLabel: '', phaseProgressPct: 0 };
  let bossX = width / 2;
  let bossY = height * 0.46;
  let beatPhase = 0;
  let lastStrike: { point: Vec2; accuracy: number } | null = null;

  const radius = (): number => Math.min(width, height) * STRIKE_RADIUS_FRACTION;

  const barMetrics = (): { barW: number; x: number; y: number } => {
    const barW = Math.min(560, width * 0.7);
    return { barW, x: (width - barW) / 2, y: BAR_TOP };
  };

  /** Timing cue: a ring that contracts toward the boss as the next beat approaches. */
  const drawBeat = (): void => {
    // Distance to the nearest beat, 0 (on beat) .. 0.5 (furthest), normalised to [0,1].
    const toBeat = Math.min(beatPhase, 1 - beatPhase) * 2;
    const r = radius() * (0.35 + 0.65 * toBeat);
    // Brightest on the beat, dim between beats — reinforces the "strike now" moment.
    const alpha = 0.25 + 0.55 * (1 - toBeat);
    beatRing.clear().circle(bossX, bossY, r).stroke({ width: 3, color: 0x58a6ff, alpha });
  };

  /** Confirmation marker at the last strike point, tinted green (accurate) → red (poor). */
  const drawStrikeMark = (): void => {
    strikeMark.clear();
    if (!lastStrike) return;
    const good = Math.round(0xff * (1 - lastStrike.accuracy));
    const bad = Math.round(0xff * lastStrike.accuracy);
    const color = (good << 16) | (bad << 8);
    const { x, y } = lastStrike.point;
    strikeMark.circle(x, y, 10).stroke({ width: 2, color });
    strikeMark.moveTo(x - 14, y).lineTo(x + 14, y).moveTo(x, y - 14).lineTo(x, y + 14).stroke({ width: 2, color });
  };

  const redraw = (): void => {
    // Background: dark backdrop + a lighter floor band.
    const floorY = height * 0.72;
    background.clear();
    background.rect(0, 0, width, height).fill(0x0e1116);
    background.rect(0, floorY, width, height - floorY).fill(0x161b22);

    // Boss, centred in the upper-middle, scaled gently with viewport width.
    bossX = width / 2;
    bossY = height * 0.46;
    boss.position.set(bossX, bossY);
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

    drawBeat();
    drawStrikeMark();
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
    bossCenter(): Vec2 {
      return { x: bossX, y: bossY };
    },
    strikeRadius(): number {
      return radius();
    },
    setBeat(phase: number): void {
      beatPhase = ((phase % 1) + 1) % 1;
      drawBeat();
    },
    markStrike(point: Vec2, accuracy: number): void {
      lastStrike = { point, accuracy };
      drawStrikeMark();
    },
    applyShake(offset: ShakeOffset): void {
      world.position.set(offset.x, offset.y);
      boss.rotation = offset.rotation;
    },
    drawParticles(items: ParticleItem[]): void {
      particlesGfx.clear();
      for (const p of items) {
        particlesGfx.circle(p.x, p.y, p.radius).fill({ color: p.color, alpha: p.alpha });
      }
    },
    drawFloaters(items: FloatingItem[]): void {
      for (let i = 0; i < floaters.length; i++) {
        const slot = floaters[i];
        if (!slot) continue;
        const item = items[i];
        if (!item) {
          slot.visible = false;
          continue;
        }
        slot.visible = true;
        slot.text = item.text;
        slot.position.set(item.x, item.y);
        slot.alpha = item.alpha;
        slot.scale.set(item.scale);
        slot.tint = item.color;
      }
    },
    destroy(): void {
      root.destroy({ children: true });
    },
  };
}
