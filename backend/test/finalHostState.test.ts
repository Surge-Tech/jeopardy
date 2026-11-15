import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('Final Jeopardy private previews can be restored only by an authorized room host', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jeopardy-final-host-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const storage = await import('../src/storage/boardStorage.js');
  const gm = await import('../src/socket/gameManager.js');
  const final = await import('../src/socket/finalJeopardy.js');
  const broadcasts: { room: string; event: string; payload: any }[] = [];
  const io = { to: (room: string) => ({ emit: (event: string, payload: unknown) => broadcasts.push({ room, event, payload: structuredClone(payload) }) }) } as unknown as Server;
  const session = gm.createSession('board');
  gm.setMode(session.roomCode, 'individual');
  const room = session.roomCode;
  try {
    const board = await storage.createBoard({ name: 'Final test', finalJeopardy: { category: 'Final', clue: 'Clue', clueAudioUrl: '/recording.mp3', response: 'Answer', timerSeconds: 45 } });
    session.boardId = board.id;
    const player = gm.addPlayer(room, 'Per', '#ffffff')!;
    gm.setScore(room, player.id, 1000);
    gm.startGame(room);
    await final.startFinal(io, room);
    assert.equal(session.finalJeopardy?.clueAudioUrl, undefined);
    final.revealCategory(io, room);
    assert.equal(session.finalJeopardy?.clueAudioUrl, undefined);
    final.submitWager(io, room, player.id, 500);
    final.revealClue(io, room, false);
    assert.equal(session.finalJeopardy?.clueAudioUrl, '/recording.mp3');
    const recordingId = session.finalJeopardy?.clueRecordingId;
    assert.ok(recordingId);
    final.finishRecording(io, room, 'stale-recording');
    assert.equal(session.finalJeopardy?.clueRecordingId, recordingId);
    assert.equal(session.finalJeopardy?.deadline, null);
    final.finishRecording(io, room, recordingId);
    assert.equal(session.finalJeopardy?.clueRecordingId, null);
    assert.equal(session.finalJeopardy?.stage, 'answering', 'finishing narration starts the countdown');
    assert.equal(session.finalJeopardy!.deadline! - session.finalJeopardy!.serverNow, 45000);
    const deadline = session.finalJeopardy?.deadline;
    const broadcastCount = broadcasts.length;
    final.finishRecording(io, room, recordingId);
    final.startTimer(io, room);
    assert.equal(session.finalJeopardy?.deadline, deadline, 'duplicate completion and manual start cannot reset the countdown');
    assert.equal(broadcasts.length, broadcastCount);
    final.saveDraft(io, room, player.id, 'Private draft');
    function client(authorized: boolean) {
      const handlers = new Map<string, (payload: object) => void>();
      const received: { event: string; payload: any }[] = [];
      final.registerFinalHandlers(io, { rooms: new Set(authorized ? [`host:${room}`] : [room]),
        on: (event: string, handler: (payload: object) => void) => handlers.set(event, handler),
        emit: (event: string, payload: unknown) => received.push({ event, payload }),
      } as unknown as Socket, new Map());
      return { request: (roomCode: string) => handlers.get(E.HOST_FJ_GET_STATE)!({ roomCode }), received };
    }
    const phone = client(false);
    phone.request(room);
    assert.equal(phone.received.some(r => r.event === E.FJ_HOST_STATE), false);
    const host = client(true);
    host.request(room);
    assert.deepEqual(host.received.at(-1), { event: E.FJ_HOST_STATE, payload: { wagers: { [player.id]: 500 }, answers: {}, drafts: { [player.id]: 'Private draft' } } });
    host.request('OTHER');
    assert.equal(host.received.at(-1)?.event, 'error');
    assert.equal(JSON.stringify(session).includes('Private draft'), false);
    assert.equal(broadcasts.some(b => b.room === room && JSON.stringify(b.payload).includes('Private draft')), false);
  } finally {
    final.cleanup(room); gm.deleteSession(room);
    if (previous === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
