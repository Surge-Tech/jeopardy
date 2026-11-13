import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import type { Board, GameState, Question } from '../../backend/src/shared/types';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('admin media controls follow visible clues and answers, including Daily Double and Final Jeopardy', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.media-controls-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const sent: unknown[] = [];
  const listeners = new Map<string, Function>();
  (globalThis as any).__mediaControlSocket = { on: (event: string, fn: Function) => listeners.set(event, fn), off: (event: string) => listeners.delete(event), emit: (event: string, payload: unknown) => sent.push({ event, payload }) };
  await build({
    entryPoints: [join(testDir, '../src/components/host/BoardMediaControls.tsx')], outfile: join(tempDir, 'controls.mjs'),
    bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
    plugins: [{ name: 'test-socket', setup(builder) {
      builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__mediaControlSocket;', loader: 'js' }));
    } }],
  });
  const { default: Controls } = await import(pathToFileURL(join(tempDir, 'controls.mjs')).href);
  const root = createRoot(document.getElementById('root')!);
  const question: Question = { id: 'q', value: 200, clue: 'Clue', response: 'Answer', mediaType: 'video', mediaUrl: '/clue.mp4', responseMediaType: 'audio', responseMediaUrl: '/answer.mp3' };
  const board = { rounds: [{ categories: [{ questions: [question] }] }] } as unknown as Board;
  const state = { phase: 'playing', currentRoundIndex: 0, activeQuestionId: 'q', clueVisible: false } as GameState;
  const render = () => act(async () => root.render(<Controls board={board} gameState={state} roomCode="ROOM" />));
  const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === name)!;
  try {
    await render();
    assert.equal(document.querySelector('section'), null);
    state.clueVisible = true;
    state.clueRecordingId = 'reading';
    question.clueAudioUrl = '/reading.mp3';
    await render();
    await act(async () => button('Play').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'q:recording', action: 'play', value: undefined } });
    state.clueRecordingId = null;
    await render();
    await act(async () => button('Play').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'q:clue', action: 'play', value: undefined } });
    await act(async () => listeners.get(E.BOARD_MEDIA_STATUS)!({ mediaId: 'other', playing: true }));
    assert.ok(button('Play'));
    await act(async () => listeners.get(E.BOARD_MEDIA_STATUS)!({ mediaId: 'q:clue', playing: true }));
    assert.ok(button('Pause'));
    assert.equal(button('Play'), undefined);
    await act(async () => button('Pause').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'q:clue', action: 'pause', value: undefined } });
    await act(async () => listeners.get(E.BOARD_MEDIA_STATUS)!({ mediaId: 'q:clue', playing: false }));
    assert.ok(button('Play'));
    state.buzzedPlayerId = 'player';
    await render();
    assert.equal(button('Play').disabled, true);
    assert.equal(document.querySelectorAll('button').length, 3);
    assert.equal(document.querySelector('input[type=range]'), null);
    assert.equal(button('Pause'), undefined);
    state.responseVisible = true;
    await render();
    await act(async () => button('Skip back 10 seconds').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'q:response', action: 'seek', value: -10 } });
    question.responseMediaUrl = '';
    await render();
    assert.equal(button('Play').disabled, false);
    await act(async () => button('Play').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'q:clue', action: 'play', value: undefined } });
    Object.assign(question, { isDailyDouble: true });
    state.responseVisible = false;
    state.dailyDoubleRevealed = false;
    await render();
    assert.equal(document.querySelector('section'), null);
    state.dailyDoubleRevealed = true;
    state.buzzedPlayerId = null;
    await render();
    state.finalJeopardy = { stage: 'clue', mediaType: 'youtube', mediaUrl: 'https://youtu.be/dQw4w9WgXcQ' } as GameState['finalJeopardy'];
    await render();
    await act(async () => button('Skip forward 10 seconds').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'final:clue', action: 'seek', value: 10 } });
    state.finalJeopardy!.stage = 'locked';
    await render();
    assert.equal(document.querySelector('section'), null);
    state.finalJeopardy!.stage = 'response';
    Object.assign(state.finalJeopardy!, { responseMediaType: 'video', responseMediaUrl: '/final-answer.mp4' });
    await render();
    await act(async () => button('Play').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'final:response', action: 'play', value: undefined } });
    state.finalJeopardy!.responseMediaUrl = '';
    await render();
    await act(async () => button('Play').click());
    assert.deepEqual(sent.pop(), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId: 'final:clue', action: 'play', value: undefined } });
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
    delete (globalThis as any).__mediaControlSocket;
    await rm(tempDir, { recursive: true, force: true });
  }
});
