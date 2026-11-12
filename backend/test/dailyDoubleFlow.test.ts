import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server, Socket } from 'socket.io';
import { registerSocketHandlers } from '../src/socket/socketHandler.js';
import * as gm from '../src/socket/gameManager.js';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

for (const outcome of ['correct', 'wrong'] as const) {
  test(`Daily Double ${outcome} is scored once and stays open for answer reveal and close`, () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const rooms = new Set<string>();
    const broadcasts: any[] = [];
    const socket = { id: `dd-${outcome}`, rooms,
      on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
      join: (room: string) => rooms.add(room), emit: () => {},
    } as unknown as Socket;
    const io = {
      on: (_event: string, handler: (socket: Socket) => void) => handler(socket),
      to: () => ({ emit: (event: string, payload: unknown) => broadcasts.push({ event, payload: structuredClone(payload) }) }),
    } as unknown as Server;
    registerSocketHandlers(io);
    const session = gm.createSession('board');
    const roomCode = session.roomCode;
    const send = (event: string, payload: object = {}) => handlers.get(event)!({ roomCode, ...payload });
    try {
      send(E.HOST_JOIN);
      const player = gm.addPlayer(roomCode, 'Per', '#ffffff')!;
      send(E.HOST_OPEN_QUESTION, { questionId: 'dd', isDailyDouble: true, boardHighValue: 1000 });
      assert.equal(session.dailyDouble?.stage, 'picking');
      send(E.HOST_REVEAL_DD);
      assert.equal(session.dailyDoubleRevealed, false, 'cannot reveal before wagering');
      send(E.HOST_DD_PICK_PLAYER, { playerId: player.id });
      assert.equal(session.dailyDouble?.stage, 'wagering');
      send(E.HOST_DD_OVERRIDE_WAGER, { amount: 500 });
      assert.equal(session.dailyDouble?.wager, 500);
      const judge = { playerId: player.id, delta: outcome === 'correct' ? 500 : -500, outcome, isDailyDouble: true };
      send(E.HOST_SCORE, judge);
      assert.equal(player.score, 0, 'cannot judge a hidden clue');
      send(E.HOST_REVEAL_DD);
      assert.equal(session.dailyDoubleRevealed, true);
      assert.equal(session.buzzerState, 'idle');
      send(E.HOST_SHOW_RESPONSE);
      assert.equal(session.responseVisible, false, 'cannot reveal answer before judging');
      assert.equal(gm.closeQuestion(roomCode), false, 'cannot dismiss an unjudged Daily Double');
      assert.equal(gm.openQuestion(roomCode, 'other', false), false, 'cannot replace a Daily Double');
      send(E.HOST_DD_OVERRIDE_WAGER, { amount: 1000 });
      assert.equal(session.dailyDouble?.wager, 500, 'wager is locked once the clue is revealed');
      send(E.HOST_SCORE, judge);
      assert.equal(player.score, judge.delta);
      assert.equal(session.dailyDouble?.outcome, outcome);
      assert.equal(session.activeQuestionId, 'dd');
      assert.equal(session.responseVisible, false);
      assert.equal(broadcasts.at(-1).payload.dailyDouble.outcome, outcome, 'judgment is broadcast for resumed hosts');
      send(E.HOST_SCORE, judge);
      assert.equal(player.score, judge.delta, 'duplicate judgments cannot score twice');
      assert.equal(player.stats?.[outcome], 1);
      send(E.HOST_SHOW_RESPONSE);
      assert.equal(session.responseVisible, true);
      assert.equal(gm.closeQuestion(roomCode), true);
      assert.equal(session.dailyDouble, null);
      assert.equal(session.activeQuestionId, null);
    } finally {
      handlers.get('disconnect')?.(); gm.deleteSession(roomCode);
    }
  });
}
