import type { Application } from 'pixi.js';
import type { InputBuffer } from './input.js';
import type { StrikeInput } from './contribution.js';

/**
 * Pointer/touch DOM adapter for the contribution action (P0-C-3 / OOM-19).
 *
 * The thin browser edge of the aim-and-strike mechanic: it listens for a press on the Pixi canvas
 * (mouse *and* touch via unified Pointer Events) and pushes a raw {@link StrikeInput} into the shared
 * {@link InputBuffer}. It holds no game logic — coordinates are translated to canvas space and the
 * fixed-step loop (in `pixiApp.ts`) drains + resolves them. Verified by typecheck + build like the
 * other Pixi-facing modules; the logic it feeds is unit-tested in `input`/`contribution`.
 */

export interface PointerInput {
  destroy: () => void;
}

/** Map a DOM client-space point to the Pixi canvas's logical (screen) coordinate space. */
function toCanvasPoint(app: Application, clientX: number, clientY: number): { x: number; y: number } {
  const rect = app.canvas.getBoundingClientRect();
  // Guard against a zero-sized rect (canvas not yet laid out) to avoid divide-by-zero.
  const scaleX = rect.width > 0 ? app.screen.width / rect.width : 1;
  const scaleY = rect.height > 0 ? app.screen.height / rect.height : 1;
  return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
}

export function attachPointerInput(
  app: Application,
  buffer: InputBuffer<StrikeInput>,
  now: () => number = () => Date.now(),
): PointerInput {
  const canvas = app.canvas;

  const onPointerDown = (event: PointerEvent): void => {
    const point = toCanvasPoint(app, event.clientX, event.clientY);
    buffer.push({ point, clientTs: now() });
  };

  // `touch-action: none` lets us own touch gestures without the browser scrolling/zooming.
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);

  return {
    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
    },
  };
}
