import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server, Socket } from 'socket.io';
import { registerSocketHandlers } from '../src/socket/socketHandler.js';
import * as gm from '../src/socket/gameManager.js';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('host refresh resumes the full session; stale and different-board rooms create a fresh session', () => {
  let connect!: (socket: Socket) => void;
  const io = { on: (_event: string, handler: typeof connect) => { connect = handler; } } as unknown as Server;
  registerSocketHandlers(io);
  const created: string[] = [];
  function open(boardId: string, roomCode?: string) {
    const handlers = new Map<string, (payload: unknown) => void>();
    const rooms = new Set<string>();
    let result: { roomCode: string; state: ReturnType<typeof gm.createSession>; resumed: boolean };
    connect({
      rooms,
      on: (event: string, handler: (payload: unknown) => void) => handlers.set(event, handler),
      join: (room: string) => rooms.add(room),
      emit: (event: string, payload: typeof result) => {
        assert.equal(event, E.HOST_CREATED);
        result = payload;
      },
    } as unknown as Socket);
    handlers.get(E.HOST_CREATE)!({ boardId, roomCode });
    assert.ok(rooms.has(result!.roomCode));
    assert.ok(rooms.has(`host:${result!.roomCode}`));
    assert.ok(rooms.has(`hostpanel:${result!.roomCode}`));
    created.push(result!.roomCode);
    return result!;
  }
  try {
    const first = open('board');
    assert.equal(first.resumed, false);
    const player = gm.addPlayer(first.roomCode, 'Alice', '#fff')!;
    gm.updateScore(first.roomCode, player.id, 600);
    gm.openQuestion(first.roomCode, 'question', false);
    first.state.answeredQuestions.push('previous-question');
    const before = structuredClone(first.state);
    const refreshed = open('board', first.roomCode);
    assert.equal(refreshed.roomCode, first.roomCode);
    assert.equal(refreshed.resumed, true);
    assert.deepEqual(refreshed.state, before);

    const differentBoard = open('other-board', first.roomCode);
    assert.equal(differentBoard.resumed, false);
    assert.notEqual(differentBoard.roomCode, first.roomCode);
    assert.equal(differentBoard.state.boardId, 'other-board');

    gm.deleteSession(first.roomCode);
    const expired = open('board', first.roomCode);
    assert.equal(expired.resumed, false);
    assert.deepEqual(expired.state.players, []);
  } finally {
    created.forEach(room => gm.deleteSession(room));
  }
});
