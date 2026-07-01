import {
  ContributionMessage,
  createLogger,
  type TickSnapshot,
  type EventState,
} from '@overworld/shared';

/**
 * Minimal client entry (P-1 foundation).
 *
 * Proves the /client package builds against the SAME shared contracts the server uses — the
 * anti-drift guarantee. The Pixi arena, netcode, and real rendering land in P0/P1
 * (OOM-16..24, OOM-32).
 */
const logger = createLogger('client', 'debug');

/** Build a contribution using the shared schema (server will re-validate + score it). */
function makeContribution(playerId: string): ContributionMessage {
  return ContributionMessage.parse({
    playerId,
    actionType: 'strike',
    inputParams: { power: 1 },
    clientTs: 0,
  });
}

/** Render the authoritative state pushed by the server each tick. */
function render(tick: TickSnapshot): void {
  const state: EventState = tick.eventState;
  const app = document.getElementById('app');
  if (app) {
    app.textContent = `Boss HP: ${state.bossHp} — phase ${state.phase} (${state.phaseProgressPct}%)`;
  }
}

const contribution = makeContribution('local-player');
logger.info('client bootstrapped', { actionType: contribution.actionType });

export { makeContribution, render };
