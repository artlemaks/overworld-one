import './styles.css';
import { startApp } from './app.js';

/**
 * Client entry (P0-C-0 / OOM-16). Mounts the landing -> join -> arena flow.
 * The Pixi arena scene (OOM-17/18) and contribution action (OOM-19) build on top of this.
 */
const root = document.getElementById('app');
if (root) {
  startApp(root, { storage: window.localStorage });
}
