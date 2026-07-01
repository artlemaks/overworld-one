import type { Session } from '../session.js';

/**
 * Arena placeholder (P0-C-0 / OOM-16).
 *
 * OOM-16 only needs to *land the player in the arena*. This renders a mount point
 * (`#arena-canvas`) that the Pixi scene (OOM-17/18) attaches to, plus a minimal presence line.
 * Returns the canvas mount so the caller/next task can hand it to Pixi.
 */
export function mountArena(root: HTMLElement, session: Session): HTMLElement {
  root.replaceChildren();

  const screen = document.createElement('section');
  screen.className = 'screen screen--arena';

  const canvas = document.createElement('div');
  canvas.id = 'arena-canvas';
  canvas.className = 'arena__canvas';
  // Placeholder copy until the Pixi scene mounts here (OOM-17).
  canvas.textContent = 'Entering the arena…';

  const presence = document.createElement('p');
  presence.className = 'arena__presence';
  presence.setAttribute('data-testid', 'presence');
  // Short, human-friendly slice of the anon id — full playerId is used on the wire.
  presence.textContent = `You’re in as ${session.playerId.slice(0, 8)}`;

  screen.append(canvas, presence);
  root.append(screen);
  return canvas;
}
