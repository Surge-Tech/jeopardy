import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server } from 'socket.io';

test('answer media persists independently and Final Jeopardy publishes it only on answer reveal', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jeopardy-answer-test-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const storage = await import('../src/storage/boardStorage.js');
  const gm = await import('../src/socket/gameManager.js');
  const final = await import('../src/socket/finalJeopardy.js');
  const io = { to: () => ({ emit: () => {} }) } as unknown as Server;
  let room: string | undefined;
  try {
    const question = { id: 'question', value: 200, clue: 'Clue', response: '', mediaType: 'audio' as const, mediaUrl: '/media/clue.mp3', responseMediaType: 'audio' as const, responseMediaUrl: '/media/answer.wav' };
    const board = await storage.createBoard({ name: 'Test', rounds: [{ id: 'round', pointValues: [200], categories: [{ id: 'category', name: 'Test', questions: [question] }] }], finalJeopardy: { category: 'Final', clue: 'Final clue', response: 'Final answer', mediaType: 'audio', mediaUrl: '/media/final-clue.mp3', responseMediaType: 'audio', responseMediaUrl: '/media/final-answer.wav' } });
    assert.deepEqual((await storage.getBoard(board.id))?.rounds[0].categories[0].questions[0], question);
    const session = gm.createSession(board.id);
    gm.setMode(session.roomCode, 'individual');
    room = session.roomCode;
    gm.addPlayer(room, 'Player', '#ffffff');
    gm.startGame(room);
    assert.deepEqual(await final.startFinal(io, room), { ok: true });
    assert.equal(session.finalJeopardy?.responseMediaUrl, undefined);
    final.revealCategory(io, room);
    final.revealClue(io, room, true);
    assert.equal(session.finalJeopardy?.mediaUrl, '/media/final-clue.mp3');
    assert.equal(session.finalJeopardy?.responseMediaUrl, undefined);
    final.showResponse(io, room);
    assert.equal(session.finalJeopardy?.responseMediaUrl, '/media/final-answer.wav');
    assert.equal(session.finalJeopardy?.mediaType, 'audio');
    assert.equal(session.finalJeopardy?.responseMediaType, 'audio');
    assert.equal(session.finalJeopardy?.response, 'Final answer');
    const updated = await storage.updateBoard(board.id, { name: 'Renamed' });
    assert.deepEqual(updated?.rounds, board.rounds);
    assert.deepEqual(updated?.finalJeopardy, board.finalJeopardy);
    const legacy = await storage.createBoard({ name: 'Text only', finalJeopardy: { category: 'Final', clue: 'Clue', response: 'Answer' } });
    final.cleanup(room);
    gm.deleteSession(room);
    const legacySession = gm.createSession(legacy.id);
    gm.setMode(legacySession.roomCode, 'individual');
    room = legacySession.roomCode;
    gm.addPlayer(room, 'Player', '#ffffff');
    gm.startGame(room);
    await final.startFinal(io, room);
    final.showResponse(io, room);
    assert.equal(legacySession.finalJeopardy?.response, 'Answer');
    assert.equal(legacySession.finalJeopardy?.responseMediaUrl, undefined);
  } finally {
    if (room) { final.cleanup(room); gm.deleteSession(room); }
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
