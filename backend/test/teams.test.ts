import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'socket.io';
import * as gm from '../src/socket/gameManager.js';
import { getCompetitor, getCompetitors } from '../src/shared/competitors.js';

function setup() {
  const session = gm.createSession('board');
  const room = session.roomCode;
  const alice = gm.addPlayer(room, 'Alice', '#ffffff')!;
  const bob = gm.addPlayer(room, 'Bob', '#ffffff')!;
  const carol = gm.addPlayer(room, 'Carol', '#ffffff')!;
  gm.setMode(room, 'teams');
  gm.saveTeam(room, undefined, 'Blue', '#0000ff');
  gm.saveTeam(room, undefined, 'Red', '#ff0000');
  const [blue, red] = session.teams;
  gm.assignTeam(room, alice.id, blue.id);
  gm.assignTeam(room, bob.id, blue.id);
  gm.assignTeam(room, carol.id, red.id);
  return { session, room, alice, bob, carol, blue, red };
}

test('team setup validates membership, names and captains and freezes on the first clue', () => {
  const { session, room, alice, blue, red } = setup();
  try {
    assert.equal(gm.saveTeam(room, undefined, ' blue ', '#ffffff').ok, false);
    assert.equal(gm.saveTeam(room, undefined, 'Bad', 'red').ok, false);
    assert.equal(gm.setCaptain(room, red.id, alice.id).ok, false);
    gm.assignTeam(room, alice.id, null);
    assert.equal(blue.captainPlayerId, null);
    assert.equal(gm.startGame(room), false);
    assert.equal(gm.openQuestion(room, 'q', false), false);
    gm.assignTeam(room, alice.id, blue.id);
    assert.equal(gm.openQuestion(room, 'q', false), true);
    assert.equal(session.phase, 'playing');
    assert.equal(gm.assignTeam(room, alice.id, red.id).ok, false);
    assert.equal(gm.removeTeam(room, blue.id).ok, false);
    assert.equal(gm.saveTeam(room, blue.id, 'New', '#ffffff').ok, false);
    assert.equal(gm.setMode(room, 'individual').ok, false);
    gm.removePlayer(room, alice.id);
    assert.ok(session.players.includes(alice));
  } finally { gm.deleteSession(room); }
});

test('team scoring is shared, early penalties are personal and wrong answers lock out every teammate', () => {
  const { session, room, alice, bob, carol, blue, red } = setup();
  try {
    gm.openQuestion(room, 'q', false);
    assert.equal(gm.recordBuzz(room, alice.id, alice.name, null), 'early');
    assert.ok(session.buzzLockouts[alice.id]);
    assert.equal(session.buzzLockouts[bob.id], undefined);
    gm.revealClue(room, 'image');
    assert.equal(gm.recordBuzz(room, bob.id, bob.name, Date.now()), 'won');
    assert.equal(session.buzzedPlayerName, 'Bob · Blue');
    assert.equal(gm.markWrongAndReopen(room, bob.id, -200), true);
    assert.equal(blue.score, -200);
    assert.equal(alice.score, 0);
    assert.equal(bob.score, 0);
    assert.equal(session.buzzLockouts[alice.id], gm.PERMANENT_LOCKOUT);
    assert.equal(session.buzzLockouts[bob.id], gm.PERMANENT_LOCKOUT);
    assert.equal(gm.recordBuzz(room, alice.id, alice.name, null), 'locked-out');
    assert.equal(gm.markWrongAndReopen(room, bob.id, -200), false);
    assert.equal(gm.recordBuzz(room, carol.id, carol.name, Date.now()), 'won');
    gm.updateScore(room, carol.id, 200);
    gm.recordOutcome(room, carol.id, 'correct');
    gm.closeQuestion(room);
    gm.openQuestion(room, 'next', false);
    assert.deepEqual(session.buzzLockouts, {});
    gm.setScore(room, blue.id, 500);
    gm.updateScore(room, alice.id, 100);
    assert.equal(getCompetitor(session, bob.id)?.score, 600);
    assert.equal(red.score, 200);
    assert.equal(getCompetitors(session).find(p => p.id === blue.id)?.stats?.wrong, 1);
    assert.equal(gm.updateScore(room, blue.id, NaN), false);
    assert.equal(gm.updateScore(room, 'missing', 100), false);
  } finally { gm.deleteSession(room); }
});

test('Daily Double uses team score and only its current captain can wager', () => {
  const { session, room, alice, bob, blue } = setup();
  try {
    gm.setScore(room, blue.id, 1500);
    gm.startGame(room);
    gm.openQuestion(room, 'dd', true);
    const dd = gm.startDailyDoubleWager(room, bob.id, 1000, true)!;
    assert.equal(dd.playerId, alice.id);
    assert.equal(dd.maxWager, 1500);
    assert.equal(gm.submitDDWager(room, bob.id, 500).ok, false);
    assert.equal(gm.setCaptain(room, blue.id, bob.id).ok, true);
    assert.equal(dd.playerId, bob.id);
    assert.equal(gm.submitDDWager(room, alice.id, 500).ok, false);
    assert.equal(gm.submitDDWager(room, bob.id, 500).ok, true);
    gm.updateScore(room, dd.playerId!, dd.wager!);
    assert.equal(blue.score, 2000);
    assert.equal(session.players.find(p => p.id === bob.id)?.score, 0);
  } finally { gm.deleteSession(room); }
});

test('Final Jeopardy has one entry per team, enforces captains, keeps secrets and rolls back team scores', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeopardy-teams-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const storage = await import('../src/storage/boardStorage.js');
  const fj = await import('../src/socket/finalJeopardy.js');
  const { session, room, alice, bob, carol, blue, red } = setup();
  const io = { to: () => ({ emit: () => {} }) } as unknown as Server;
  try {
    const board = await storage.createBoard({ name: 'Team final', finalJeopardy: { category: 'Final', clue: 'Clue', response: 'Answer' } });
    session.boardId = board.id;
    gm.setScore(room, blue.id, 1000);
    gm.setScore(room, red.id, 2000);
    assert.equal((await fj.startFinal(io, room)).ok, true);
    assert.deepEqual(session.finalJeopardy?.contestants.map(c => c.playerId), [blue.id, red.id]);
    fj.revealCategory(io, room);
    assert.equal(fj.submitWager(io, room, bob.id, 500).ok, false);
    assert.equal(fj.submitWager(io, room, blue.id, 500).ok, false);
    assert.equal(fj.submitWager(io, room, alice.id, 500).ok, true);
    assert.equal(fj.submitWager(io, room, carol.id, 200).ok, true);
    assert.equal(JSON.stringify(session).includes('"wager":500'), false);
    gm.setCaptain(room, blue.id, bob.id);
    assert.equal(fj.submitWager(io, room, bob.id, 600).ok, false);
    fj.revealClue(io, room, false);
    fj.startTimer(io, room);
    assert.equal(fj.saveDraft(io, room, alice.id, 'Old captain').ok, false);
    assert.equal(fj.submitAnswer(io, room, alice.id, 'Old captain').ok, false);
    assert.equal(fj.saveDraft(io, room, bob.id, 'Private draft').ok, true);
    assert.equal(fj.submitAnswer(io, room, bob.id, 'Private answer').ok, true);
    assert.equal(JSON.stringify(session).includes('Private'), false);
    fj.lockAnswers(io, room);
    fj.beginReveal(io, room);
    fj.revealStep(io, room);
    fj.revealStep(io, room);
    fj.judge(io, room, blue.id, true);
    assert.equal(blue.score, 1500);
    assert.equal(alice.score, 0);
    assert.equal(session.finalJeopardy?.revealed[blue.id].answer, 'Private answer');
    fj.judge(io, room, blue.id, true);
    assert.equal(blue.score, 1500);
    assert.equal(getCompetitors(session).find(p => p.id === blue.id)?.stats?.correct, 1);
    fj.undo(io, room);
    assert.equal(blue.score, 1000);
    assert.equal(getCompetitors(session).find(p => p.id === blue.id)?.stats?.correct, 0);
  } finally {
    fj.cleanup(room);
    gm.deleteSession(room);
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});

test('team socket controls require a host and Daily Double device availability follows captain reconnects', async () => {
  const { registerSocketHandlers } = await import('../src/socket/socketHandler.js');
  const { SOCKET_EVENTS: E } = await import('../src/shared/socketEvents.js');
  const { session, room, alice, bob, blue } = setup();
  let connect: (socket: any) => void = () => {};
  const io = {
    on: (_event: string, handler: typeof connect) => { connect = handler; },
    to: () => ({ emit: () => {} }),
  } as unknown as Server;
  registerSocketHandlers(io);
  function client(id: string) {
    const handlers = new Map<string, (...args: any[]) => void>();
    const rooms = new Set<string>();
    connect({
      id, rooms,
      join: (r: string) => rooms.add(r),
      on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
      emit: () => {},
    });
    return { send: (event: string, ...args: any[]) => handlers.get(event)?.(...args) };
  }
  const host = client('team-host');
  const first = client('team-first');
  const second = client('team-second');
  try {
    let ack: any;
    first.send(E.HOST_SET_MODE, { roomCode: room, mode: 'individual' }, (r: any) => { ack = r; });
    assert.equal(ack.ok, false);
    assert.equal(session.mode, 'teams');
    const beforeAssignment = structuredClone(session);
    first.send(E.HOST_AUTO_ASSIGN_TEAMS, { roomCode: room }, (r: any) => { ack = r; });
    assert.equal(ack.ok, false);
    assert.deepEqual(session, beforeAssignment);
    host.send(E.HOST_JOIN, { roomCode: room });
    host.send(E.HOST_AUTO_ASSIGN_TEAMS, { roomCode: room }, (r: any) => { ack = r; });
    assert.equal(ack.ok, true);
    assert.ok(session.players.every(p => session.teams.some(t => t.id === p.teamId)));
    // The host can still adjust an automatic assignment before starting.
    for (const player of session.players) gm.assignTeam(room, player.id, player.id === alice.id || player.id === bob.id ? blue.id : session.teams[1].id);
    gm.setCaptain(room, blue.id, alice.id);
    first.send(E.PLAYER_REJOIN, { roomCode: room, playerId: alice.id });
    second.send(E.PLAYER_REJOIN, { roomCode: room, playerId: bob.id });
    host.send(E.HOST_START, { roomCode: room }, (r: any) => { ack = r; });
    assert.equal(ack.ok, true);
    gm.setLastCorrectPlayer(room, bob.id);
    host.send(E.HOST_OPEN_QUESTION, { roomCode: room, questionId: 'dd', isDailyDouble: true, boardHighValue: 1000 });
    assert.equal(session.dailyDouble?.playerId, alice.id);
    assert.equal(session.dailyDouble?.hasDevice, true);
    first.send('disconnect');
    assert.equal(session.dailyDouble?.hasDevice, false);
    first.send(E.PLAYER_REJOIN, { roomCode: room, playerId: alice.id });
    assert.equal(session.dailyDouble?.hasDevice, true);
    host.send(E.HOST_SET_CAPTAIN, { roomCode: room, teamId: blue.id, playerId: bob.id }, (r: any) => { ack = r; });
    assert.equal(ack.ok, true);
    assert.equal(session.dailyDouble?.playerId, bob.id);
    first.send(E.DD_WAGER, { amount: 200 }, (r: any) => { ack = r; });
    assert.equal(ack.ok, false);
    second.send(E.DD_WAGER, { amount: 200 }, (r: any) => { ack = r; });
    assert.equal(ack.ok, true);
    assert.equal(session.dailyDouble?.wager, 200);
    const late = client('late-player');
    late.send(E.PLAYER_JOIN, { roomCode: room, name: 'Late', color: '#ffffff' });
    assert.equal(session.players.some(p => p.name === 'Late'), false);
  } finally {
    first.send('disconnect');
    second.send('disconnect');
    gm.deleteSession(room);
  }
});

test('auto-assignment balances the full roster, chooses valid captains and preserves identities and scores', () => {
  const { session, room, blue } = setup();
  try {
    gm.saveTeam(room, undefined, 'Green', '#00ff00');
    for (let i = 0; i < 5; i++) gm.addPlayer(room, `Extra ${i}`, '#ffffff');
    gm.setScore(room, blue.id, 400);
    const players = [...session.players];
    const teams = session.teams.map(t => ({ id: t.id, name: t.name, color: t.color, score: t.score }));
    for (let attempt = 0; attempt < 3; attempt++) {
      assert.deepEqual(gm.autoAssignTeams(room), { ok: true });
      assert.deepEqual(session.players, players); // Same references, order and IDs.
      assert.ok(session.players.every((p, i) => p === players[i]));
      const sizes = session.teams.map(team => {
        const members = session.players.filter(p => p.teamId === team.id);
        assert.ok(members.some(p => p.id === team.captainPlayerId));
        return members.length;
      });
      assert.deepEqual([...sizes].sort(), [2, 3, 3]);
      assert.equal(sizes.reduce((sum, n) => sum + n, 0), players.length);
      assert.deepEqual(session.teams.map(t => ({ id: t.id, name: t.name, color: t.color, score: t.score })), teams);
    }
    assert.equal(gm.startGame(room), true);
  } finally { gm.deleteSession(room); }
});

test('auto-assignment rejects invalid setups and games that have started without mutating them', () => {
  assert.equal(gm.autoAssignTeams('missing').ok, false);
  const { session, room } = setup();
  function rejected() {
    const before = structuredClone(session);
    assert.equal(gm.autoAssignTeams(room).ok, false);
    assert.deepEqual(session, before);
  }
  try {
    session.mode = 'individual';
    rejected();
    session.mode = 'teams';
    session.phase = 'playing';
    rejected();
    session.phase = 'finished';
    rejected();
    session.phase = 'lobby';
    gm.saveTeam(room, undefined, 'Green', '#00ff00');
    gm.saveTeam(room, undefined, 'Yellow', '#ffff00');
    rejected(); // Four teams, three players.
    session.teams = session.teams.slice(0, 1);
    rejected();
    session.teams = [];
    rejected();
  } finally { gm.deleteSession(room); }
});
