import { WebSocket } from 'ws';
import { encode, decodeServerMessage } from '@overworld/shared';

/**
 * One-client end-to-end smoke (P1 verification).
 *
 * Connects a single real client to a *running* server, joins, sends one contribution, and prints the
 * welcome / contribAck / first tick it receives. Used to prove the full Redis-backed path boots and
 * round-trips a contribution (the load harness exercises the same path but with in-memory stores).
 *
 *   Usage: tsx src/harness/smokeClient.ts [ws://localhost:8080]
 */
const url = process.argv[2] ?? 'ws://localhost:8080';
const ws = new WebSocket(url);
const got = { welcome: false, ack: false, tick: false };

ws.on('open', () => {
  ws.send(encode({ type: 'join', playerId: 'smoke-1' }));
  ws.send(
    encode({
      type: 'contribution',
      seq: 0,
      contribution: {
        playerId: 'smoke-1',
        actionType: 'strike',
        inputParams: { aimAccuracy: 1, timingQuality: 1 },
        clientTs: Date.now(),
      },
    }),
  );
});

ws.on('message', (data) => {
  const msg = decodeServerMessage(data.toString('utf8'));
  if (msg.type === 'welcome') {
    got.welcome = true;
    process.stdout.write(`welcome bossHpMax=${msg.bossHpMax}\n`);
  }
  if (msg.type === 'contribAck') {
    got.ack = true;
    process.stdout.write(`contribAck accepted=${msg.accepted} points=${msg.points}\n`);
  }
  if (msg.type === 'tick' && !got.tick) {
    got.tick = true;
    process.stdout.write(
      `tick bossHp=${msg.snapshot.eventState.bossHp} phase=${msg.snapshot.eventState.phase}\n`,
    );
  }
});

setTimeout(() => {
  process.stdout.write(`RESULT ${JSON.stringify(got)}\n`);
  ws.close();
  process.exit(got.welcome && got.ack && got.tick ? 0 : 1);
}, 2500);
