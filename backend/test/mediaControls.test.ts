import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Server, Socket } from 'socket.io';
import { registerSocketHandlers } from '../src/socket/socketHandler.js';
import { createSession, deleteSession } from '../src/socket/gameManager.js';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('media commands require room host membership, validate values and only reach that room', () => {
  const session = createSession('media-board');
  const handlers = new Map<string, Function>();
  const rooms = new Set<string>();
  const sent: Array<{ room: string; event: string; payload: unknown }> = [];
  const socket = { rooms, on: (event: string, handler: Function) => handlers.set(event, handler) };
  const io = {
    on: (_event: string, handler: (socket: Socket) => void) => handler(socket as unknown as Socket),
    to: (room: string) => ({ emit: (event: string, payload: unknown) => sent.push({ room, event, payload }) }),
  } as unknown as Server;
  registerSocketHandlers(io);
  const dispatch = (overrides = {}) => {
    let result: { ok: boolean; error?: string } | undefined;
    handlers.get(E.HOST_MEDIA_COMMAND)!({ roomCode: session.roomCode, mediaId: 'q:clue', action: 'play', ...overrides }, (res: typeof result) => { result = res; });
    return result!;
  };
  try {
    let statusResult: { ok: boolean } | undefined;
    handlers.get(E.HOST_MEDIA_STATUS)!({ roomCode: session.roomCode, mediaId: 'q:clue', playing: true }, (result: { ok: boolean }) => { statusResult = result; });
    assert.equal(statusResult?.ok, false);
    assert.equal(dispatch().ok, false);
    assert.equal(sent.length, 0);
    rooms.add(`host:${session.roomCode}`);
    assert.equal(dispatch().ok, true);
    assert.deepEqual(sent.pop(), { room: `host:${session.roomCode}`, event: E.BOARD_MEDIA_COMMAND, payload: { mediaId: 'q:clue', action: 'play', value: undefined } });
    handlers.get(E.HOST_MEDIA_STATUS)!({ roomCode: session.roomCode, mediaId: 'q:clue', playing: true });
    assert.deepEqual(sent.pop(), { room: `host:${session.roomCode}`, event: E.BOARD_MEDIA_STATUS, payload: { mediaId: 'q:clue', playing: true } });
    handlers.get(E.HOST_MEDIA_STATUS)!({ roomCode: session.roomCode, mediaId: 'q:clue', playing: 'invalid' });
    assert.equal(sent.length, 0);
    for (const command of [{ action: 'invalid' }, { action: 'seek', value: NaN }, { action: 'seek', value: 61 }, { action: 'seek', value: -61 }, { action: 'restart' }, { action: 'volume', value: 10 }, { action: 'mute' }, { mediaId: null }, { roomCode: 'OTHER' }]) {
      assert.equal(dispatch(command).ok, false);
    }
    assert.equal(sent.length, 0);
    handlers.get(E.HOST_MEDIA_STATUS)!({ roomCode: session.roomCode, mediaId: 'q:clue', playing: false, currentTime: 42, duration: 120, playbackRate: 1.5 });
    assert.deepEqual(sent.pop()?.payload, { mediaId: 'q:clue', playing: false, currentTime: 42, duration: 120, playbackRate: 1.5 });
    for (const timing of [{ currentTime: NaN }, { duration: Infinity }, { currentTime: -1 }, { playbackRate: 'fast' }]) {
      handlers.get(E.HOST_MEDIA_STATUS)!({ roomCode: session.roomCode, mediaId: 'q:clue', playing: true, ...timing });
      assert.equal(sent.length, 0);
    }
    for (const value of [-1, NaN, Infinity, '12']) assert.equal(dispatch({ action: 'seekTo', value }).ok, false);
    assert.equal(dispatch({ action: 'seekTo', value: 120 }).ok, true);
    assert.deepEqual(sent.pop()?.payload, { mediaId: 'q:clue', action: 'seekTo', value: 120 });
    for (const action of ['pause', 'seek', 'status']) {
      assert.equal(dispatch({ action, value: 10 }).ok, true);
      assert.equal(sent.pop()?.room, `host:${session.roomCode}`);
    }
  } finally {
    deleteSession(session.roomCode);
  }
});
