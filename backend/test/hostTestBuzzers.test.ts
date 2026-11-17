import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server, Socket } from 'socket.io';
import { registerSocketHandlers } from '../src/socket/socketHandler.js';
import * as gm from '../src/socket/gameManager.js';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('host test buzzes share phone timing, history, team eligibility and scoring without creating a player device', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const callbacks: Array<() => void> = [];
  t.mock.method(globalThis, 'setTimeout', (callback: () => void) => { callbacks.push(callback); return 0 as any; });
  let connect!: (socket: Socket) => void;
  const broadcasts: Array<{ room: string; event: string; payload: any }> = [];
  const io = {
    on: (_event: string, handler: typeof connect) => { connect = handler; },
    to: (room: string) => ({ emit: (event: string, payload: any) => broadcasts.push({ room, event, payload: structuredClone(payload) }) }),
  } as unknown as Server;
  registerSocketHandlers(io);
  function client(id: string) {
    const handlers = new Map<string, (...args: any[]) => void>();
    const rooms = new Set<string>();
    connect({ id, rooms,
      on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
      join: (room: string) => rooms.add(room), emit: () => {},
    } as unknown as Socket);
    return { send: (event: string, ...args: any[]) => handlers.get(event)?.(...args) };
  }
  const session = gm.createSession('board');
  gm.setMode(session.roomCode, 'individual');
  const room = session.roomCode;
  const otherRoom = gm.createSession('other');
  gm.setMode(otherRoom.roomCode, 'individual');
  const host = client('test-buzz-host');
  const phone = client('test-buzz-phone');
  const stranger = client('test-buzz-stranger');
  let result: any;
  const ack = (value: any) => { result = value; };
  try {
    host.send(E.HOST_JOIN, { roomCode: room });
    host.send(E.HOST_ADD_PLAYER, { roomCode: room, name: 'Alice', color: '#ffffff' });
    host.send(E.HOST_ADD_PLAYER, { roomCode: room, name: 'Bob', color: '#ffffff' });
    phone.send(E.PLAYER_JOIN, { roomCode: room, name: 'Carol', color: '#ffffff' });
    const [alice, bob, carol] = session.players;
    gm.setMode(room, 'teams');
    gm.saveTeam(room, undefined, 'Blue', '#0000ff');
    gm.saveTeam(room, undefined, 'Red', '#ff0000');
    const [blue, red] = session.teams;
    gm.assignTeam(room, alice.id, blue.id);
    gm.assignTeam(room, bob.id, blue.id);
    gm.assignTeam(room, carol.id, red.id);

    const before = structuredClone(session);
    stranger.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: alice.id }, ack);
    assert.equal(result.ok, false);
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: otherRoom.roomCode, playerId: alice.id }, ack);
    assert.equal(result.ok, false);
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: 'missing' }, ack);
    assert.equal(result.ok, false);
    assert.deepEqual(session, before);

    host.send(E.HOST_START, { roomCode: room });
    host.send(E.HOST_OPEN_QUESTION, { roomCode: room, questionId: 'q1', isDailyDouble: false });
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: alice.id }, ack);
    assert.equal(result.outcome, 'early');
    assert.equal(alice.stats?.earlyBuzzes, 1);
    assert.equal(session.buzzLockouts[bob.id], undefined);
    assert.equal(broadcasts.at(-1)?.room, `hostpanel:${room}`);
    gm.revealClue(room, 'image');
    host.send(E.HOST_ENABLE_BUZZER, { roomCode: room });
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: alice.id }, ack);
    assert.equal(result.outcome, 'locked-out');
    now += 300;
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: alice.id }, ack);
    assert.equal(result.outcome, 'won');
    assert.equal(session.buzzedPlayerId, alice.id);
    assert.equal(session.buzzHistory[0].reactionMs, 300);
    assert.equal(session.answerTimer?.deadline, now + 10000);
    assert.ok(broadcasts.some(b => b.room === room && b.event === E.BUZZ_WINNER && b.payload.playerName === 'Alice · Blue'));
    now += 10;
    phone.send(E.BUZZ);
    assert.deepEqual(session.buzzHistory.map(b => b.playerId), [alice.id, carol.id]);
    assert.equal(session.buzzedPlayerId, alice.id);
    now += gm.BUZZ_COLLECTION_MS;
    callbacks.shift()!();
    assert.equal(session.buzzWindow, null);
    assert.equal(broadcasts.at(-1)?.event, E.GAME_STATE);
    host.send(E.HOST_WRONG_REOPEN, { roomCode: room, playerId: alice.id, delta: -200 });
    assert.equal(blue.score, -200);
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: bob.id }, ack);
    assert.equal(result.outcome, 'locked-out');
    assert.equal(session.buzzLockouts[bob.id], gm.PERMANENT_LOCKOUT);
    phone.send(E.BUZZ);
    assert.equal(session.buzzedPlayerId, carol.id);
    host.send(E.HOST_SCORE, { roomCode: room, playerId: carol.id, delta: 200, outcome: 'correct' });
    assert.equal(red.score, 200);
    assert.equal(carol.stats?.correct, 1);
    gm.closeQuestion(room);
    gm.setLastCorrectPlayer(room, alice.id);
    now += 1000;
    host.send(E.HOST_OPEN_QUESTION, { roomCode: room, questionId: 'dd', isDailyDouble: true, boardHighValue: 1000 });
    host.send(E.HOST_ACTIVATE_DD, { roomCode: room, boardHighValue: 1000 });
    assert.equal(session.dailyDouble?.hasDevice, false);
    host.send(E.HOST_BUZZ_PLAYER, { roomCode: room, playerId: alice.id }, ack);
    assert.equal(result.outcome, 'ignored');
    assert.equal(session.buzzedPlayerId, null);
    assert.equal(gm.overrideDDWager(room, 100).ok, true);
  } finally {
    host.send('disconnect');
    phone.send('disconnect');
    stranger.send('disconnect');
    gm.deleteSession(room);
    gm.deleteSession(otherRoom.roomCode);
  }
});

test('host test buzzes are rate-limited and a host socket never acts as a player phone', () => {
  let connect!: (socket: Socket) => void;
  const io = { on: (_event: string, handler: typeof connect) => { connect = handler; }, to: () => ({ emit: () => {} }) } as unknown as Server;
  registerSocketHandlers(io);
  const handlers = new Map<string, (...args: any[]) => void>();
  const rooms = new Set<string>();
  connect({ id: 'rate-limited-test-host', rooms, join: (room: string) => rooms.add(room), emit: () => {},
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
  } as unknown as Socket);
  const session = gm.createSession('board');
  gm.setMode(session.roomCode, 'individual');
  const room = session.roomCode;
  const player = gm.addPlayer(room, 'Admin player', '#ffffff')!;
  let result: any;
  try {
    handlers.get(E.HOST_JOIN)!({ roomCode: room });
    gm.startGame(room);
    gm.openQuestion(room, 'q', false);
    handlers.get(E.BUZZ)!();
    assert.equal(player.stats, undefined);
    for (let i = 0; i < 11; i++) handlers.get(E.HOST_BUZZ_PLAYER)!({ roomCode: room, playerId: player.id }, (r: any) => { result = r; });
    assert.equal(result.ok, false);
    assert.match(result.error, /Too many buzz/);
    assert.equal(player.stats?.earlyBuzzes, 10);
  } finally {
    handlers.get('disconnect')!();
    gm.deleteSession(room);
  }
});
