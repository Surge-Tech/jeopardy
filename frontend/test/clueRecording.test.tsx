import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Editor from '../src/pages/Editor';
import FinalJeopardyEditor from '../src/components/final/FinalJeopardyEditor';
import FinalClueMedia from '../src/components/final/FinalClueMedia';
import type { FinalJeopardyBoard, FinalPublicState } from '../../backend/src/shared/types';
import type { Board, GameState, Question } from '../../backend/src/shared/types';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('clue recording uploads, previews, saves and removes independently of clue and answer media', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const question: Question = { id: 'q', value: 200, clue: 'Clue', response: 'Answer', mediaType: 'image', mediaUrl: '/clue.png', responseMediaType: 'audio', responseMediaUrl: '/answer.mp3' };
  const board = { id: 'board', name: 'Test', rounds: [{ id: 'round', pointValues: [200], categories: [{ id: 'cat', name: 'Category', questions: [question] }] }] };
  let written: Board | undefined;
  let uploads = 0;
  globalThis.fetch = async (input, init) => {
    if (input === '/api/media/upload') {
      uploads++;
      return new Response(JSON.stringify({ mediaType: 'audio', url: '/recording.mp3' }));
    }
    if (init?.method === 'PUT') written = JSON.parse(init.body as string);
    return new Response(JSON.stringify(board));
  };
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/edit/board']}><Routes><Route path="/edit/:boardId" element={<Editor />} /></Routes></MemoryRouter>));
    await act(async () => document.querySelector<HTMLButtonElement>('tbody button')!.click());
    const upload = document.querySelector<HTMLInputElement>('input[aria-label="Clue recording (optional) upload"]')!;
    assert.match(upload.accept, /audio/);
    assert.doesNotMatch(upload.closest('fieldset')!.textContent!, /YouTube/);
    Object.defineProperty(upload, 'files', { value: [new Blob(['image'], { type: 'image/png' })], configurable: true });
    await act(async () => upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.equal(uploads, 0);
    assert.match(document.querySelector('[role=alert]')!.textContent!, /Choose an audio/);
    Object.defineProperty(upload, 'files', { value: [new Blob(['audio'], { type: 'audio/mpeg' })] });
    await act(async () => upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.equal(document.querySelector('audio[aria-label="Clue recording (optional) preview"]')!.getAttribute('src'), '/recording.mp3');
    const save = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save')!;
    await act(async () => save().click());
    const saved = () => written!.rounds[0].categories[0].questions[0];
    assert.equal(saved().clueAudioUrl, '/recording.mp3');
    assert.equal(saved().mediaUrl, '/clue.png');
    assert.equal(saved().responseMediaUrl, '/answer.mp3');
    await act(async () => [...upload.closest('fieldset')!.querySelectorAll('button')].find(b => b.textContent === 'Remove Media')!.click());
    await act(async () => save().click());
    assert.equal(saved().clueAudioUrl, undefined);
    assert.equal(saved().mediaUrl, '/clue.png');
    assert.equal(saved().responseMediaUrl, '/answer.mp3');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});

for (const isDailyDouble of [false, true]) {
  test(`${isDailyDouble ? 'Daily Double' : 'Regular clue'} recording waits through blocked playback and pauses, reports actual ending, and never replays a completed reading`, async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const tempDir = await mkdtemp(join(testDir, '.recording-'));
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const old = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const sent: unknown[] = [];
    (globalThis as any).__recordingSocket = { emit: (event: string, payload: unknown) => sent.push({ event, payload }) };
    await build({
      entryPoints: [join(testDir, '../src/components/shared/QuestionClueMedia.tsx')], outfile: join(tempDir, 'recording.mjs'),
      bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'test-socket', setup(builder) {
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__recordingSocket;', loader: 'js' }));
      } }],
    });
    const { default: Media } = await import(pathToFileURL(join(tempDir, 'recording.mjs')).href);
    const root = createRoot(document.getElementById('root')!);
    let blocked = true;
    const plays: string[] = [];
    dom.window.HTMLMediaElement.prototype.play = async function () {
      plays.push(this.getAttribute('src')!);
      if (blocked) throw new Error('Autoplay blocked');
    };
    dom.window.HTMLMediaElement.prototype.pause = () => {};
    const question: Question = { isDailyDouble, id: 'q', clue: 'Clue', response: 'Answer', value: 200, clueAudioUrl: '/reading.mp3', mediaType: 'video', mediaUrl: '/clue.mp4' };
    const state = { phase: 'playing', clueVisible: true, clueRecordingId: 'reading-1' } as GameState;
    const render = () => act(async () => root.render(<Media key={question.id} question={question} gameState={{ ...state }} roomCode="ROOM" />));
    try {
      await render();
      assert.deepEqual(plays, ['/reading.mp3']);
      assert.match(document.querySelector('[role=alert]')!.textContent!, /Press play/);
      assert.equal(sent.length, 0);
      const recording = document.querySelector<HTMLAudioElement>('audio[aria-label="Clue recording"]')!;
      assert.equal(recording.hidden, true);
      assert.equal(recording.controls, false);
      blocked = false;
      await act(async () => window.dispatchEvent(new dom.window.CustomEvent('board-media-command', { detail: { mediaId: 'q:recording', action: 'play' } })));
      await act(async () => recording.dispatchEvent(new dom.window.Event('pause')));
      assert.equal(sent.length, 0);
      await act(async () => recording.dispatchEvent(new dom.window.Event('error')));
      assert.match(document.querySelector('[role=alert]')!.textContent!, /could not be played/);
      assert.equal(sent.length, 0);
      await act(async () => recording.dispatchEvent(new dom.window.Event('ended')));
      assert.deepEqual(sent, [{ event: E.HOST_CLUE_RECORDING_ENDED, payload: { roomCode: 'ROOM', questionId: 'q', recordingId: 'reading-1' } }]);
      state.clueRecordingId = null;
      await render();
      assert.equal(document.querySelector('audio'), null);
      assert.equal(plays.at(-1), '/clue.mp4');
      state.buzzedPlayerId = 'player';
      await render();
      state.buzzedPlayerId = null;
      await render();
      assert.equal(document.querySelector('audio'), null);
      assert.equal(sent.length, 1);
      await act(async () => root.unmount());
      // Refresh after completion: only ordinary clue media starts.
      const refreshed = createRoot(document.getElementById('root')!);
      await act(async () => refreshed.render(<Media question={question} gameState={state} roomCode="ROOM" />));
      assert.equal(document.querySelector('audio'), null);
      await act(async () => refreshed.unmount());
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, old);
      delete (globalThis as any).__recordingSocket;
      await rm(tempDir, { recursive: true, force: true });
    }
  });

}

test('Final Jeopardy recording uploads, persists when reopened and removes independently of other media', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let root = createRoot(document.getElementById('root')!);
  let saved: FinalJeopardyBoard = { category: 'Final', clue: 'Clue', response: 'Answer', mediaType: 'image', mediaUrl: '/image.png', responseMediaType: 'audio', responseMediaUrl: '/answer.mp3' };
  globalThis.fetch = async () => new Response(JSON.stringify({ mediaType: 'audio', url: '/final-reading.mp3' }));
  const render = () => act(async () => root.render(<FinalJeopardyEditor finalJeopardy={saved} onSave={value => { saved = value; }} onRemove={() => {}} onClose={() => {}} />));
  const save = () => act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save')!.click());
  try {
    await render();
    const upload = document.querySelector<HTMLInputElement>('input[aria-label="Clue recording (optional) upload"]')!;
    assert.match(upload.accept, /audio/);
    Object.defineProperty(upload, 'files', { value: [new Blob(['audio'], { type: 'audio/mpeg' })] });
    await act(async () => upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.equal(document.querySelector('audio[aria-label="Clue recording (optional) preview"]')!.getAttribute('src'), '/final-reading.mp3');
    await save();
    assert.equal(saved.clueAudioUrl, '/final-reading.mp3');
    await act(async () => root.unmount());
    root = createRoot(document.getElementById('root')!);
    await render();
    const preview = document.querySelector('audio[aria-label="Clue recording (optional) preview"]')!;
    assert.equal(preview.getAttribute('src'), '/final-reading.mp3');
    await act(async () => [...preview.parentElement!.querySelectorAll('button')].find(b => b.textContent === 'Remove Media')!.click());
    await save();
    assert.equal(saved.clueAudioUrl, undefined);
    assert.equal(saved.mediaUrl, '/image.png');
    assert.equal(saved.responseMediaUrl, '/answer.mp3');
  } finally {
    await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, old);
  }
});

test('Final Jeopardy narration handles blocked playback, holds other media and does not replay after completion', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const old = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    const sent: unknown[] = [];
    const root = createRoot(document.getElementById('root')!);
    let blocked = true;
    const plays: string[] = [];
    dom.window.HTMLMediaElement.prototype.play = async function () {
      plays.push(this.getAttribute('src')!);
      if (blocked) throw new Error('Autoplay blocked');
    };
    dom.window.HTMLMediaElement.prototype.pause = () => {};
    const state = { stage: 'clue', clueRecordingId: 'reading-1', clueAudioUrl: '/reading.mp3', mediaType: 'video', mediaUrl: '/clue.mp4' } as FinalPublicState;
    const render = () => act(async () => root.render(<FinalClueMedia finalJeopardy={{ ...state }} onRecordingEnded={(recordingId: string) => sent.push({ event: E.HOST_FJ_RECORDING_ENDED, payload: { roomCode: 'ROOM', recordingId } })} />));
    try {
      await render();
      assert.deepEqual(plays, ['/reading.mp3']);
      assert.match(document.querySelector('[role=alert]')!.textContent!, /Press play/);
      assert.equal(sent.length, 0);
      const recording = document.querySelector<HTMLAudioElement>('audio[aria-label="Clue recording"]')!;
      assert.equal(recording.hidden, true);
      assert.equal(recording.controls, false);
      blocked = false;
      await act(async () => window.dispatchEvent(new dom.window.CustomEvent('board-media-command', { detail: { mediaId: 'final:recording', action: 'play' } })));
      await act(async () => recording.dispatchEvent(new dom.window.Event('pause')));
      assert.equal(sent.length, 0);
      await act(async () => recording.dispatchEvent(new dom.window.Event('error')));
      assert.match(document.querySelector('[role=alert]')!.textContent!, /could not be played/);
      assert.equal(sent.length, 0);
      await act(async () => recording.dispatchEvent(new dom.window.Event('ended')));
      assert.deepEqual(sent, [{ event: E.HOST_FJ_RECORDING_ENDED, payload: { roomCode: 'ROOM', recordingId: 'reading-1' } }]);
      state.clueRecordingId = null;
      await render();
      assert.equal(document.querySelector('audio'), null);
      assert.equal(plays.at(-1), '/clue.mp4');
      state.stage = 'answering';
      await render();
      assert.equal(document.querySelector('audio'), null);
      assert.equal(sent.length, 1);
      await act(async () => root.unmount());
      // Refresh after completion: only ordinary clue media starts.
      const refreshed = createRoot(document.getElementById('root')!);
      await act(async () => refreshed.render(<FinalClueMedia finalJeopardy={state} onRecordingEnded={(recordingId: string) => sent.push({ event: E.HOST_FJ_RECORDING_ENDED, payload: { roomCode: 'ROOM', recordingId } })} />));
      assert.equal(document.querySelector('audio'), null);
      await act(async () => refreshed.unmount());
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, old);
    }
});
