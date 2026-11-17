import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Server, Socket } from 'socket.io';
import { SOCKET_EVENTS as E } from '../src/shared/socketEvents.js';

test('recorded clues wait for authenticated playback completion, then open buzzers and start timing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'jeopardy-recording-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dir;
  const storage = await import('../src/storage/boardStorage.js');
  const gm = await import('../src/socket/gameManager.js');
  const { registerSocketHandlers } = await import('../src/socket/socketHandler.js');
  const handlers = new Map<string, (payload: any, ack?: Function) => void>();
  const rooms = new Set<string>();
  const emitted: string[] = [];
  let stateReceived: (() => void) | undefined;
  const socket = {
    rooms, on: (event: string, handler: any) => handlers.set(event, handler),
    emit: (event: string) => emitted.push(event),
  };
  const io = {
    on: (_event: string, handler: (socket: Socket) => void) => handler(socket as unknown as Socket),
    to: () => ({ emit: (event: string) => {
      emitted.push(event);
      if (event === E.GAME_STATE) stateReceived?.();
    } }),
  } as unknown as Server;
  registerSocketHandlers(io);
  let room: string | undefined;
  try {
    const board = await storage.createBoard({ rounds: [{ id: 'round', pointValues: [200], categories: [{
      id: 'category', name: 'Test', questions: [{ id: 'q', value: 200, clue: 'Clue', response: 'Answer',
        mediaType: 'video', mediaUrl: '/video.mp4', clueAudioUrl: '/reading.mp3' }],
    }] }] });
    assert.equal((await storage.getBoard(board.id))!.rounds[0].categories[0].questions[0].clueAudioUrl, '/reading.mp3');
    const session = gm.createSession(board.id);
    room = session.roomCode;
    rooms.add(`host:${room}`);
    gm.setMode(room, 'individual');
    const player = gm.addPlayer(room, 'Player', '#ff0000')!;
    const second = gm.addPlayer(room, 'Second', '#00ff00')!;
    gm.startGame(room);
    async function reveal() {
      gm.openQuestion(room!, 'q', false);
      const received = new Promise<void>(resolve => { stateReceived = resolve; });
      handlers.get(E.HOST_REVEAL_CLUE)!({ roomCode: room });
      await received;
      stateReceived = undefined;
      return session.clueRecordingId!;
    }
    const recordingId = await reveal();
    assert.ok(recordingId);
    assert.equal(session.buzzerState, 'idle');
    assert.equal(session.questionTimer, null);
    assert.equal(gm.recordBuzz(room, player.id, player.name, null), 'early');
    const complete = (id = recordingId, questionId = 'q') => handlers.get(E.HOST_CLUE_RECORDING_ENDED)!({ roomCode: room, questionId, recordingId: id });
    rooms.clear();
    complete();
    assert.equal(session.buzzerState, 'idle');
    rooms.add(`host:${room}`);
    complete('stale');
    complete(recordingId, 'different-question');
    assert.equal(session.buzzerState, 'idle');
    emitted.length = 0;
    complete();
    assert.equal(session.buzzerState, 'open');
    assert.equal(session.clueRecordingId, null);
    assert.equal(session.questionTimer?.remainingMs, 30000);
    assert.ok(session.questionTimer?.deadline);
    assert.ok(emitted.includes(E.BUZZER_OPEN));
    const timer = session.questionTimer;
    complete();
    assert.equal(session.questionTimer, timer);
    assert.equal(gm.recordBuzz(room, player.id, player.name, Date.now()), 'locked-out');
    assert.equal(gm.recordBuzz(room, second.id, second.name, Date.now()), 'won');
    complete();
    assert.equal(session.buzzerState, 'locked');
    gm.markWrongAndReopen(room, second.id, -200);
    gm.closeQuestion(room);

    // Every action that supersedes a reading invalidates its completion.
    for (const action of ['answer', 'close', 'lock', 'manual-open', 'reset', 'end'] as const) {
      const token = await reveal();
      if (action === 'answer') gm.showResponse(room);
      if (action === 'close') gm.closeQuestion(room);
      if (action === 'lock') gm.lockBuzzer(room);
      if (action === 'manual-open') gm.enableBuzzer(room);
      if (action === 'reset') gm.resetBuzzer(room);
      if (action === 'end') gm.endGame(room);
      const buzzer = session.buzzerState;
      complete(token);
      assert.equal(session.buzzerState, buzzer, action);
      assert.equal(session.clueRecordingId, null, action);
      gm.closeQuestion(room);
    }
    gm.resumeGame(room);
    const stale = await reveal();
    gm.closeQuestion(room);
    const fresh = await reveal();
    assert.notEqual(fresh, stale);
    complete(stale);
    assert.equal(session.buzzerState, 'idle');
    complete(fresh);
    assert.equal(session.buzzerState, 'open');
    gm.closeQuestion(room);

    // Daily Double recordings start the answer timer, without opening buzzers.
    for (const mode of ['auto', 'disabled', 'manual', 'judged'] as const) {
      gm.openQuestion(room, 'q', true);
      gm.startDailyDoubleWager(room, player.id, 1000, false);
      gm.overrideDDWager(room, 500);
      gm.setDailyDoubleTime(room, mode === 'disabled' ? 0 : 23);
      await handlers.get(E.HOST_REVEAL_DD)!({ roomCode: room });
      const token = session.clueRecordingId!;
      assert.ok(token);
      assert.equal(session.dailyDouble!.timer, undefined);
      complete(stale);
      complete(token, 'other');
      rooms.clear();
      complete(token);
      rooms.add(`host:${room}`);
      assert.equal(session.dailyDouble!.timer, undefined, 'stale and unauthorized completions are ignored');
      if (mode === 'manual') gm.startDailyDoubleTimer(room);
      if (mode === 'judged') gm.recordOutcome(room, player.id, 'correct');
      const manualTimer = session.dailyDouble!.timer;
      emitted.length = 0;
      complete(token);
      assert.equal(session.clueRecordingId, null);
      assert.equal(session.buzzerState, 'idle');
      assert.equal(session.questionTimer, null);
      assert.equal(emitted.includes(E.BUZZER_OPEN), false);
      const timer = session.dailyDouble!.timer;
      if (mode === 'auto' || mode === 'manual') {
        assert.ok(timer);
        assert.equal(timer.deadline - timer.startedAt, 23000);
        if (mode === 'manual') assert.equal(timer, manualTimer);
      } else assert.ok(!timer);
      complete(token);
      assert.equal(session.dailyDouble!.timer, timer, 'duplicate completion cannot restart timing');
      if (mode !== 'judged') gm.recordOutcome(room, player.id, 'correct');
      gm.closeQuestion(room);
    }
  } finally {
    if (room) gm.deleteSession(room);
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
