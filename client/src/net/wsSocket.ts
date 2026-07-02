import type { NetSocket, NetSocketHandlers, SocketFactory } from './netClient.js';

/**
 * Browser WebSocket adapter (P1-C-1 / OOM-32).
 *
 * The one impurity behind the pure {@link createNetClient}: adapts the platform `WebSocket` to the
 * {@link SocketFactory} seam. Kept trivially thin (no logic) so all netcode behaviour lives in the
 * testable core, not here.
 */
export const browserSocketFactory: SocketFactory = (
  url: string,
  handlers: NetSocketHandlers,
): NetSocket => {
  const ws = new WebSocket(url);
  ws.addEventListener('open', () => handlers.onOpen());
  ws.addEventListener('message', (ev) => handlers.onMessage(String(ev.data)));
  ws.addEventListener('close', () => handlers.onClose());
  ws.addEventListener('error', () => ws.close());

  return {
    send(data) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    },
    close() {
      ws.close();
    },
  };
};
