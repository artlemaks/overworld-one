import { describe, it, expect } from 'vitest';
import {
  encode,
  decodeClientMessage,
  decodeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';

describe('protocol encode/decode', () => {
  it('round-trips a join message', () => {
    const msg: ClientMessage = { type: 'join', playerId: 'p1' };
    expect(decodeClientMessage(encode(msg))).toEqual(msg);
  });

  it('round-trips a contribution frame with its nested shared contract', () => {
    const msg: ClientMessage = {
      type: 'contribution',
      seq: 3,
      contribution: {
        playerId: 'p1',
        actionType: 'strike',
        inputParams: { aimAccuracy: 0.9, timingQuality: 0.8 },
        clientTs: 123,
      },
    };
    expect(decodeClientMessage(encode(msg))).toEqual(msg);
  });

  it('round-trips a tick frame', () => {
    const msg: ServerMessage = {
      type: 'tick',
      snapshot: {
        eventState: {
          bossHp: 900,
          phase: 'phase-1',
          phaseProgressPct: 10,
          contribWaveCount: 4,
          playersContributingNow: 12,
        },
        aggregateStats: { contribDelta: -100, contribRate: 8 },
        serverTs: 1000,
      },
    };
    expect(decodeServerMessage(encode(msg))).toEqual(msg);
  });

  it('rejects an unknown message type', () => {
    expect(() => decodeClientMessage(JSON.stringify({ type: 'nope' }))).toThrow();
  });

  it('rejects a contribution with a missing playerId', () => {
    const bad = { type: 'contribution', seq: 1, contribution: { actionType: 'strike', clientTs: 0 } };
    expect(() => decodeClientMessage(JSON.stringify(bad))).toThrow();
  });

  it('rejects a welcome with a non-positive bossHpMax', () => {
    const bad = { type: 'welcome', playerId: 'p', bossHpMax: 0, tickHz: 4, serverTs: 0 };
    expect(() => decodeServerMessage(JSON.stringify(bad))).toThrow();
  });
});
