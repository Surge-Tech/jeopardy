import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('all buzzers stay open until manually closed, including after reopening', { timeout: 10000 }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jeopardy-media-timer-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const storage = await import('../src/storage/boardStorage.js');
  const gm = await import('../src/socket/gameManager.js');
  const { registerSocketHandlers } = await import('../src/socket/socketHandler.js');
  const handlers = new Map<string, (payload: any) => void>();
  const rooms = new Set<string>();
  let stateReceived: (() => void) | undefined;
  const socket = { rooms, on: (event: string, handler: (payload: any) => void) => handlers.set(event, handler) };
  const io = {
    on: (_event: string, handler: (socket: Socket) => void) => handler(socket as unknown as Socket),
    to: () => ({ emit: (event: string) => {
      if (event === E.GAME_STATE) stateReceived?.();
    } }),
  } as unknown as Server;
  registerSocketHandlers(io);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  async function dispatch(event: string, payload: object) {
    const received = new Promise<void>(resolve => { stateReceived = resolve; });
    handlers.get(event)!(payload);
    await received;
    stateReceived = undefined;
  }
  let room: string | undefined;
  try {
    const board = await storage.createBoard({ rounds: [{ id: 'round', pointValues: [200], categories: [{
      id: 'category', name: 'Test', questions: [
        ...(['image', 'audio', 'video', 'youtube'] as const).map(mediaType => ({ id: mediaType, value: 200, clue: 'Clue', response: 'Answer', mediaType, mediaUrl: '/media' })),
        { id: 'image-only', value: 200, clue: '', response: 'Answer', mediaType: 'image', mediaUrl: '/image' },
        { id: 'image-whitespace', value: 200, clue: '  \n ', response: 'Answer', mediaType: 'image', mediaUrl: '/image' },
        { id: 'text', value: 200, clue: 'Text clue', response: 'Answer' },
      ],
    }] }] });
    const session = gm.createSession(board.id);
    gm.setMode(session.roomCode, 'individual');
    room = session.roomCode;
    rooms.add(`host:${room}`);
    await dispatch(E.HOST_SET_ANSWER_TIME, { roomCode: room, seconds: 20 });
    assert.equal(session.settings.answerTimeS, 20);
    const player = gm.addPlayer(room, 'First', '#ff0000')!;
    const second = gm.addPlayer(room, 'Second', '#00ff00')!;
    for (const questionId of ['image', 'image-only', 'image-whitespace', 'audio', 'video', 'youtube', 'text']) {
      gm.startGame(room);
      await dispatch(E.HOST_OPEN_QUESTION, { roomCode: room, questionId, isDailyDouble: false });
      await dispatch(E.HOST_REVEAL_CLUE, { roomCode: room });
      if (questionId === 'text' || questionId === 'image') {
        assert.equal(session.buzzerState, 'idle');
        await dispatch(E.HOST_ENABLE_BUZZER, { roomCode: room });
      }
      assert.equal(session.buzzerState, 'open');
      t.mock.timers.tick(60000);
      assert.equal(session.buzzerState, 'open');
      assert.equal(gm.recordBuzz(room, player.id, player.name, Date.now()), 'won');
      assert.equal(gm.recordBuzz(room, second.id, second.name, Date.now()), 'recorded');
      await dispatch(E.HOST_WRONG_REOPEN, { roomCode: room, playerId: player.id, delta: -200 });
      t.mock.timers.tick(60000);
      assert.equal(session.buzzerState, 'open');
      assert.equal(session.buzzedPlayerId, null);
      assert.equal(gm.recordBuzz(room, second.id, second.name, Date.now()), 'won');
      await dispatch(E.HOST_WRONG_REOPEN, { roomCode: room, playerId: second.id, delta: -200 });
      t.mock.timers.tick(60000);
      assert.equal(session.buzzerState, 'open');
      await dispatch(E.HOST_LOCK_BUZZER, { roomCode: room });
      assert.equal(session.buzzerState, 'idle');
      await dispatch(E.HOST_RESET_BUZZER, { roomCode: room });
      t.mock.timers.tick(60000);
      assert.equal(session.buzzerState, 'open');
      await dispatch(E.HOST_CLOSE_QUESTION, { roomCode: room });
    }
  } finally {
    if (room) handlers.get(E.HOST_END)!({ roomCode: room });
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
