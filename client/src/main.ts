import './styles.css';
import { startApp } from './app.js';
import { createArena } from './arena/pixiApp.js';

/**
 * Client entry (P0-C-0/C-1 / OOM-16, OOM-17). Mounts the landing -> join -> arena flow and, on
 * join, boots Pixi into the arena canvas. Pixi lives only here so `app.ts` stays browser-free.
 */
const root = document.getElementById('app');
if (root) {
  startApp(root, {
    storage: window.localStorage,
    onArenaMount: (canvas, session) => {
      // OOM-32: when VITE_SERVER_URL is set, the arena connects to the authoritative server; otherwise
      // it runs the offline P0 mock. Lets the same build be single-player-offline or online.
      void createArena(canvas, {
        playerId: session.playerId,
        serverUrl: import.meta.env.VITE_SERVER_URL,
      });
    },
  });
}
