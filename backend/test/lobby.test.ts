import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server, Socket } from 'socket.io';
import * as gm from '../src/socket/gameManager.js';
import { startFinal } from '../src/socket/finalJeopardy.js';
import { registerSocketHandlers } from '../src/socket/socketHandler.js';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';
import { getStartGameError } from '../src/shared/lobby.js';

test('lobby phone buzzes record practice results, reset safely and never affect gameplay', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let connect!: (socket: Socket) => void;
  const broadcasts: any[] = [];
  const io = {
    on: (_event: string, handler: typeof connect) => { connect = handler; },
    to: () => ({ emit: (event: string, payload: unknown) => broadcasts.push({ event, payload: structuredClone(payload) }) }),
  } as unknown as Server;
  registerSocketHandlers(io);
  function client(id: string) {
    const handlers = new Map<string, (...args: any[]) => void>();
    const rooms = new Set<string>();
    connect({ id, rooms, join: (room: string) => rooms.add(room), emit: () => {},
      on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
    } as unknown as Socket);
    return (event: string, ...args: any[]) => handlers.get(event)!(...args);
  }
  const host = client('practice-host');
  const phone = client('practice-phone');
  const second = client('practice-second');
  const state = gm.createSession('board');
  const roomCode = state.roomCode;
  let ack: any;
  function control(action: string) { host(E.HOST_LOBBY_BUZZER, { roomCode, action }, (value: any) => { ack = value; }); }
  try {
    phone(E.HOST_LOBBY_BUZZER, { roomCode, action: 'open' }, (value: any) => { ack = value; });
    assert.equal(ack.ok, false);
    host(E.HOST_JOIN, { roomCode });
    phone(E.PLAYER_JOIN, { roomCode, name: 'Alice', color: '#ffffff' });
    second(E.PLAYER_JOIN, { roomCode, name: 'Bob', color: '#ffffff' });
    const [alice, bob] = state.players;
    gm.setMode(roomCode, 'teams'); // Practice also accepts players without assignments.
    const originalPlayers = structuredClone(state.players);
    control('invalid');
    assert.equal(ack.ok, false);
    phone(E.BUZZ);
    assert.deepEqual(state.buzzHistory, []);
    control('open');
    assert.equal(ack.ok, true);
    assert.equal(state.phase, 'lobby');
    now += 123;
    phone(E.BUZZ);
    assert.equal(state.buzzedPlayerId, alice.id);
    assert.equal(state.answerTimer, null);
    assert.equal(state.questionTimer, null);
    assert.equal(gm.validateScoreEligibility(roomCode, alice.id, false), false);
    assert.equal(gm.markWrongAndReopen(roomCode, alice.id, -100), false);
    now += 50;
    second(E.BUZZ);
    phone(E.BUZZ); // A repeated press does not duplicate the result.
    assert.deepEqual(state.buzzHistory.map(entry => [entry.playerId, entry.reactionMs]), [[alice.id, 123], [bob.id, 173]]);
    assert.ok(broadcasts.some(entry => entry.event === E.BUZZ_WINNER));
    now += 500;
    t.mock.timers.tick(500);
    assert.equal(state.buzzWindow, null);
    assert.equal(state.activeQuestionId, null);
    assert.deepEqual(state.players, originalPlayers);
    control('reset');
    assert.equal(state.buzzerState, 'idle');
    assert.deepEqual(state.buzzHistory, []);
    assert.equal(state.buzzedPlayerId, null);
    control('open');
    phone(E.BUZZ);
    const oldWindow = state.buzzWindow;
    control('reset');
    control('open');
    now += 20;
    second(E.BUZZ);
    assert.equal(state.buzzedPlayerId, bob.id);
    // Old collection callbacks cannot clear a newer window after reset.
    const newestWindow = state.buzzWindow;
    assert.ok(newestWindow);
    assert.equal(gm.finishBuzzCollection(roomCode, oldWindow), false);
    assert.equal(state.buzzWindow, newestWindow);
    gm.setMode(roomCode, 'individual');
    assert.equal(gm.startGame(roomCode), true);
    assert.equal(state.buzzerState, 'idle');
    assert.equal(state.buzzedPlayerId, null);
    assert.deepEqual(state.buzzHistory, []);
    assert.deepEqual(state.players, originalPlayers);
    t.mock.timers.tick(500);
    assert.equal(state.buzzWindow, null);
    control('reset');
    assert.equal(ack.ok, false);
    assert.equal(state.phase, 'playing');
    assert.equal(gm.openQuestion(roomCode, 'first-clue', false), true);
  } finally {
    phone('disconnect'); second('disconnect'); gm.deleteSession(roomCode);
  }
});

test('only Start game leaves the lobby, with validated setup and no gameplay side effects', async () => {
  let connect!: (socket: Socket) => void;
  const broadcasts: any[] = [];
  const io = {
    on: (_event: string, handler: typeof connect) => { connect = handler; },
    to: () => ({ emit: (event: string, payload: unknown) => broadcasts.push({ event, payload: structuredClone(payload) }) }),
  } as unknown as Server;
  registerSocketHandlers(io);
  const handlers = new Map<string, (...args: any[]) => void>();
  const rooms = new Set<string>();
  connect({ id: 'lobby-host', rooms, join: (room: string) => rooms.add(room), emit: () => {},
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
  } as unknown as Socket);
  const state = gm.createSession('board');
  const roomCode = state.roomCode;
  let ack: any;
  const send = (event: string, extra = {}) => handlers.get(event)!({ roomCode, ...extra }, (value: any) => { ack = value; });
  try {
    send(E.HOST_JOIN);
    assert.equal(state.phase, 'lobby');
    assert.equal(state.mode, 'teams');
    gm.setMode(roomCode, 'individual');
    send(E.HOST_START);
    assert.equal(ack.ok, false);
    assert.match(ack.error, /at least one player/);
    const alice = gm.addPlayer(roomCode, 'Alice', '#ffffff')!;
    const before = structuredClone(state);
    send(E.HOST_OPEN_QUESTION, { questionId: 'clue', isDailyDouble: false });
    assert.equal(gm.resumeGame(roomCode), false);
    assert.equal(gm.endGame(roomCode), false);
    assert.equal(gm.advanceRound(roomCode, 2).ok, false);
    assert.equal((await startFinal(io, roomCode)).ok, false);
    assert.equal(gm.recordBuzz(roomCode, alice.id, alice.name, null), 'ignored');
    assert.deepEqual(state, before);
    send(E.HOST_START);
    assert.deepEqual(ack, { ok: true });
    assert.equal(state.phase, 'playing');
    assert.equal(broadcasts.at(-1).event, E.GAME_STATE);
    assert.equal(broadcasts.at(-1).payload.phase, 'playing');
    assert.equal(gm.addPlayer(roomCode, 'Late arrival', '#ffffff')?.name, 'Late arrival');
    send(E.HOST_OPEN_QUESTION, { questionId: 'clue', isDailyDouble: false });
    assert.equal(state.activeQuestionId, 'clue');
    send(E.HOST_START);
    assert.equal(ack.ok, false);
    assert.equal(state.activeQuestionId, 'clue');
    assert.equal(gm.endGame(roomCode), true);
    assert.equal(gm.startGame(roomCode), false);
    assert.equal(gm.resumeGame(roomCode), true);
  } finally { gm.deleteSession(roomCode); }
});

test('team readiness catches unassigned players and invalid captains; starting locks membership', () => {
  const state = gm.createSession('board');
  const room = state.roomCode;
  try {
    const alice = gm.addPlayer(room, 'Alice', '#ffffff')!;
    const bob = gm.addPlayer(room, 'Bob', '#ffffff')!;
    gm.setMode(room, 'teams');
    assert.match(getStartGameError(state)!, /Create a team/);
    gm.saveTeam(room, undefined, 'Blue', '#0000ff');
    gm.saveTeam(room, undefined, 'Red', '#ff0000');
    const [blue, red] = state.teams;
    assert.match(getStartGameError(state)!, /Assign every player/);
    gm.assignTeam(room, alice.id, blue.id);
    gm.assignTeam(room, bob.id, red.id);
    red.captainPlayerId = alice.id;
    assert.match(getStartGameError(state)!, /captain for each team/);
    assert.equal(gm.startGame(room), false);
    gm.setCaptain(room, red.id, bob.id);
    assert.equal(getStartGameError(state), null);
    assert.equal(gm.openQuestion(room, 'q', false), false);
    assert.equal(gm.startGame(room), true);
    assert.equal(gm.addPlayer(room, 'Late arrival', '#ffffff'), null);
    assert.equal(gm.assignTeam(room, alice.id, red.id).ok, false);
    assert.equal(gm.setMode(room, 'individual').ok, false);
  } finally { gm.deleteSession(room); }
});
