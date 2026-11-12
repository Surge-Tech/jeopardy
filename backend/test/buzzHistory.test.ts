import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server, Socket } from 'socket.io';
import * as gm from '../src/socket/gameManager.js';
import { registerSocketHandlers } from '../src/socket/socketHandler.js';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('records late buzzes for exactly 500 ms, publishes results, and requires a fresh buzz after wrong', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let connect!: (socket: Socket) => void;
  const broadcasts: Array<{ room: string; event: string; payload: any }> = [];
  const io = {
    on: (_event: string, handler: typeof connect) => { connect = handler; },
    to: (room: string) => ({ emit: (event: string, payload: unknown) => {
      broadcasts.push({ room, event, payload: structuredClone(payload) });
    } }),
  } as unknown as Server;
  registerSocketHandlers(io);
  const session = gm.createSession('board');
  const room = session.roomCode;
  function client(id: string) {
    const handlers = new Map<string, (payload?: any) => void>();
    const rooms = new Set<string>();
    const socket = {
      id, rooms, join: (room: string) => rooms.add(room), emit: () => {},
      on: (event: string, handler: (payload?: any) => void) => handlers.set(event, handler),
    };
    connect(socket as unknown as Socket);
    return { rooms, send: (event: string, payload?: unknown) => handlers.get(event)!(payload) };
  }
  const first = client('first');
  const second = client('second');
  const third = client('third');
  const host = client('host');
  host.rooms.add(`host:${room}`);
  for (const [name, socket] of [['First', first], ['Second', second], ['Third', third]] as const) {
    socket.send(E.PLAYER_JOIN, { roomCode: room, name, color: '#fff' });
  }
  const [p1, p2, p3] = session.players;
  try {
    gm.openQuestion(room, 'clue', false);
    gm.revealClue(room, 'image');
    first.send(E.BUZZ);
    assert.equal(session.buzzedPlayerId, p1.id);
    assert.equal(session.buzzWindow?.deadline, now + 500);
    const oldWindow = session.buzzWindow;
    now += 499;
    t.mock.timers.tick(499);
    second.send(E.BUZZ);
    second.send(E.BUZZ); // repeated presses do not add duplicate rows
    assert.deepEqual(session.buzzHistory.map(e => e.playerId), [p1.id, p2.id]);
    assert.equal(session.buzzedPlayerId, p1.id);
    now += 1;
    third.send(E.BUZZ); // exactly at the deadline is too late to register
    assert.equal(session.buzzHistory.length, 2);
    t.mock.timers.tick(1);
    assert.equal(session.buzzWindow, null);
    const published = broadcasts.at(-1)!;
    assert.equal(published.room, room);
    assert.equal(published.event, E.GAME_STATE);
    assert.equal(published.payload.buzzWindow, null);
    assert.equal(published.payload.buzzHistory.length, 2);
    assert.equal(broadcasts.filter(e => e.event === E.BUZZ_WINNER).length, 1);
    host.send(E.HOST_WRONG_REOPEN, { roomCode: room, playerId: p1.id, delta: -200 });
    assert.equal(session.buzzerState, 'open');
    assert.equal(session.buzzedPlayerId, null);
    assert.deepEqual(session.buzzHistory, []);
    third.send(E.BUZZ); // even a previously unregistered player can win the rebound
    assert.equal(session.buzzedPlayerId, p3.id);
    assert.equal(gm.finishBuzzCollection(room, oldWindow), false);
    assert.ok(session.buzzWindow);
    first.send(E.BUZZ); // the incorrect contestant remains ineligible
    assert.deepEqual(session.buzzHistory.map(e => e.playerId), [p3.id]);
    second.send(E.BUZZ);
    assert.deepEqual(session.buzzHistory.map(e => e.playerId), [p3.id, p2.id]);
    // Reopen before this window's callback fires: it must not close a new attempt.
    host.send(E.HOST_WRONG_REOPEN, { roomCode: room, playerId: p3.id, delta: -200 });
    now += 100;
    t.mock.timers.tick(100);
    second.send(E.BUZZ);
    assert.equal(session.buzzedPlayerId, p2.id);
    now += 400;
    t.mock.timers.tick(400);
    assert.ok(session.buzzWindow, 'old callback cannot finish the newer window');
    now += 100;
    t.mock.timers.tick(100);
    assert.equal(session.buzzWindow, null);
  } finally {
    gm.deleteSession(room);
  }
});
