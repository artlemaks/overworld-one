import { Application } from 'pixi.js';
import { createLogger } from '@overworld/shared';
import { createFixedLoop } from './loop.js';
import { createArenaScene } from './scene.js';
import { toArenaView, PHASE_LABELS } from './sceneModel.js';
import { createPhaseTracker } from './phases.js';
import { createMockEvent } from './mockEvent.js';
import { createInputBuffer } from './input.js';
import { attachPointerInput } from './pointerInput.js';
import { createStrikeTiming, resolveStrike, type StrikeInput } from './contribution.js';
import { scoreStrike } from './scoring.js';
import {
  createFloatingText,
  createScreenShake,
  createParticles,
  createTween,
  noopSfx,
  type SfxSink,
} from './juice.js';
import { createHeat } from './heat.js';
import { prefersReducedMotion } from './layout.js';

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
  /** Sound sink for feedback juice (OOM-21); defaults to a no-op until audio lands. */
  sfx?: SfxSink;
  /** Force the reduced-motion path (OOM-24); defaults to the OS `prefers-reduced-motion` setting. */
  reducedMotion?: boolean;
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
  const sfx = options.sfx ?? noopSfx;
  // Reduced motion (OOM-24): honour the OS setting; suppress camera shake + particle sprays but
  // keep informative number pops and phase banners.
  const reducedMotion = options.reducedMotion ?? prefersReducedMotion();

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

  // Feedback juice (OOM-21): number pops, camera shake, particle bursts, and a smoothed HP bar.
  const floaters = createFloatingText();
  const shake = createScreenShake();
  const particles = createParticles();
  const hpTween = createTween(toArenaView(event.state(), BOSS_HP_MAX).hpFraction);
  // Personal heat/combo (OOM-22): skill-only, self-only effectiveness — never buyable.
  const heat = createHeat();
  // Local phase transitions (OOM-23): punctuate each HP-threshold crossing with a flash + shake.
  const phaseTracker = createPhaseTracker();

  const applyState = (): void => {
    const rawView = toArenaView(event.state(), BOSS_HP_MAX);
    hpTween.set(rawView.hpFraction);
    // HP bar slides toward the true value; text stays exact.
    scene.update({ ...rawView, hpFraction: hpTween.value() });
    scene.setBeat(timing.phase());
    scene.applyShake(shake.offset());
    scene.drawParticles(particles.items());
    scene.drawFloaters(floaters.items());
    scene.setHeat(heat.value(), heat.combo());
  };
  applyState();

  const relayout = (): void => {
    scene.layout(app.screen.width, app.screen.height);
    applyState();
  };
  app.renderer.on('resize', relayout);

  // Running local tally — a provisional P0 feel signal; the server owns the real total in P1.
  let localScoreTotal = 0;
  // Deterministic per-strike seed for particle fan rotation (no RNG in the sim).
  let strikeCount = 0;

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

      // OOM-22: heat builds from hit quality (skill only) and lifts this player's own effectiveness.
      // Self-only, never buyable (enforce-non-p2w-guardrail) — the base score comes from OOM-20.
      heat.registerHit(strike.accuracy);
      const effectiveScore = Math.round(localScore * heat.multiplier());
      localScoreTotal += effectiveScore;

      // OOM-21 juice: pop the number, kick the camera, spray sparks — all scaled by how good the hit
      // was, so a clean strike feels punchier than a graze.
      const green = Math.round(0xff * (1 - strike.accuracy));
      const red = Math.round(0xff * strike.accuracy);
      floaters.spawn(`+${effectiveScore}`, input.point.x, input.point.y, (green << 16) | (red << 8) | 0x40);
      if (!reducedMotion) {
        shake.add(0.15 + 0.35 * strike.accuracy);
        particles.burst(input.point.x, input.point.y, 6 + Math.round(10 * strike.accuracy), {
          seed: strikeCount * 0.7,
          speed: 0.12 + 0.12 * strike.accuracy,
        });
      }
      sfx.play('strike', { volume: 0.3 + 0.7 * strike.accuracy });
      strikeCount += 1;

      logger.debug('contribution', {
        actionType: message.actionType,
        accuracy: Number(strike.accuracy.toFixed(2)),
        localScore,
        heatMultiplier: Number(heat.multiplier().toFixed(2)),
        combo: heat.combo(),
        effectiveScore,
        localScoreTotal,
      });
    }
  };

  // Announce an HP-threshold phase crossing: banner at the boss, a camera kick, and a cue (OOM-23).
  const onPhaseChange = (): void => {
    const transition = phaseTracker.update(event.state().phase);
    if (!transition) return;
    const center = scene.bossCenter();
    floaters.spawn(PHASE_LABELS[transition.to], center.x, center.y - 120, 0xffffff);
    if (!reducedMotion) shake.add(0.5);
    sfx.play('phase', { volume: 0.6 });
    logger.info('phase transition', { from: transition.from, to: transition.to });
  };

  // Fixed 60 Hz simulation feeds the mock event + beat + strike ingest; render reflects it each frame.
  const loop = createFixedLoop({
    stepMs: 1000 / LOGIC_HZ,
    update: (stepMs) => {
      event.advance(stepMs);
      onPhaseChange();
      timing.advance(stepMs);
      consumeStrikes();
      // Advance juice on the fixed step so effects are deterministic and frame-rate independent.
      floaters.advance(stepMs);
      shake.advance(stepMs);
      particles.advance(stepMs);
      hpTween.advance(stepMs);
      heat.advance(stepMs);
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
