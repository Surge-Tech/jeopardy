import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';
import * as gm from '../../backend/src/socket/gameManager';

test('host remembers its room across browser closures, reconnects, and clears it when closed', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.host-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const originalFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    confirm: () => true,
  });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const handlers = new Map<string, (...args: any[]) => void>();
  const emitted: Array<{ event: string; payload: any }> = [];
  const socket = {
    connected: false,
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
  };
  (globalThis as any).__hostSocket = socket;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'board', name: 'Test board', rounds: [{ id: 'round', pointValues: [200, 400], categories: [{ id: 'category', name: 'Category', questions: [{ id: 'clue', value: 200, clue: 'Test clue', response: 'Test answer' }, { id: 'dd', value: 400, clue: 'DD clue', response: 'DD answer', isDailyDouble: true }] }] }],
  }));
  let root = createRoot(document.getElementById('root')!);
  const state = gm.createSession('board');
  try {
    await build({
      entryPoints: [join(testDir, '../src/pages/Host.tsx')],
      outfile: join(tempDir, 'Host.mjs'), bundle: true, platform: 'node',
      format: 'esm', packages: 'external', jsx: 'automatic',
      tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'test-socket', setup(builder) {
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const socket = globalThis.__hostSocket;', loader: 'js',
        }));
      } }],
    });
    const { default: Host } = await import(pathToFileURL(join(tempDir, 'Host.mjs')).href);
    async function mount() {
      await act(async () => root.render(
        <React.StrictMode><MemoryRouter initialEntries={['/host/board']}>
          <Routes><Route path="/host/:boardId" element={<Host />} /><Route path="/" element={<div>Home</div>} /></Routes>
        </MemoryRouter></React.StrictMode>,
      ));
    }
    await mount();
    assert.equal(emitted.length, 0, 'wait for connection instead of buffering duplicate creation requests');
    socket.connected = true;
    await act(async () => handlers.get('connect')!());
    assert.deepEqual(emitted.at(-1), { event: E.HOST_CREATE, payload: { boardId: 'board', roomCode: undefined } });
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: state.roomCode, state, resumed: false }));
    assert.equal(window.sessionStorage.getItem('jeopardy:host-room:board'), state.roomCode);
    assert.equal(window.localStorage.getItem('jeopardy:host-room:board'), state.roomCode);

    // Correct awards points but leaves the clue open for a separate close action.
    const player = gm.addPlayer(state.roomCode, 'Player', '#ff0000')!;
    document.querySelector('select')!.focus();
    gm.openQuestion(state.roomCode, 'clue', false);
    await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state)));
    const revealButton = [...document.querySelectorAll('button')].find(button => button.textContent === 'Show Clue (Space)')!;
    assert.ok(document.activeElement === revealButton, 'selecting a card moves focus out of settings and onto the clue action');
    const beforeReveal = emitted.length;
    const space = new window.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true, cancelable: true });
    await act(async () => document.activeElement!.dispatchEvent(space));
    assert.equal(space.defaultPrevented, true, 'Space must not reactivate the focused card');
    assert.deepEqual(emitted.slice(beforeReveal), [{ event: E.HOST_REVEAL_CLUE, payload: { roomCode: state.roomCode } }]);
    gm.revealClue(state.roomCode);
    gm.enableBuzzer(state.roomCode);
    gm.setAnswerTime(state.roomCode, 0);
    gm.recordBuzz(state.roomCode, player.id, player.name, Date.now());
    await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state)));
    const beforeCorrect = emitted.length;
    await act(async () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyY', key: 'y', bubbles: true })));
    assert.deepEqual(emitted.slice(beforeCorrect), [{ event: E.HOST_SCORE, payload: {
      roomCode: state.roomCode, playerId: player.id, delta: 200, outcome: 'correct', isDailyDouble: false,
    } }]);
    gm.recordOutcome(state.roomCode, player.id, 'correct');
    await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state)));
    assert.ok(document.body.textContent?.includes('Test clue'));
    assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === '✓ Accept (Y)'), false);
    const close = [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('Close Question'))!;
    assert.equal(close.disabled, false);
    await act(async () => close.click());
    assert.deepEqual(emitted.at(-1), { event: E.HOST_CLOSE_QUESTION, payload: { roomCode: state.roomCode } });
    gm.closeQuestion(state.roomCode);

    // Daily Double rejection scores the wager without closing or reopening buzzers.
    gm.openQuestion(state.roomCode, 'dd', true);
    gm.startDailyDoubleWager(state.roomCode, player.id, 1000, false);
    gm.overrideDDWager(state.roomCode, 500);
    gm.revealDailyDouble(state.roomCode);
    await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state)));
    const beforeReject = emitted.length;
    await act(async () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyN', key: 'n', bubbles: true })));
    assert.deepEqual(emitted.slice(beforeReject), [{ event: E.HOST_SCORE, payload: {
      roomCode: state.roomCode, playerId: player.id, delta: -500, outcome: 'wrong', isDailyDouble: true,
    } }]);
    gm.recordOutcome(state.roomCode, player.id, 'wrong');
    await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state)));
    await act(async () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true })));
    assert.deepEqual(emitted.at(-1), { event: E.HOST_SHOW_RESPONSE, payload: { roomCode: state.roomCode } });
    gm.showResponse(state.roomCode);
    await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state)));
    await act(async () => document.body.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })));
    assert.deepEqual(emitted.at(-1), { event: E.HOST_CLOSE_QUESTION, payload: { roomCode: state.roomCode } });
    gm.closeQuestion(state.roomCode);

    await act(async () => root.unmount());
    // Closing a browser discards tab storage; persistent storage must recover it.
    window.sessionStorage.clear();
    root = createRoot(document.getElementById('root')!);
    await mount();
    assert.deepEqual(emitted.at(-1), { event: E.HOST_CREATE, payload: { boardId: 'board', roomCode: state.roomCode } });
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: state.roomCode, state, resumed: true }));
    assert.ok(document.body.textContent?.includes('Player'));
    await act(async () => handlers.get('connect')!());
    assert.equal(emitted.at(-1)!.payload.roomCode, state.roomCode);

    // A replacement room after server restart becomes the next resume target.
    const replacement = { ...state, roomCode: 'NEW12' };
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: replacement.roomCode, state: replacement, resumed: false }));
    assert.ok(document.body.textContent?.includes('The previous room is no longer available'));
    assert.equal(window.localStorage.getItem('jeopardy:host-room:board'), 'NEW12');
    await act(async () => handlers.get('connect')!());
    assert.equal(emitted.at(-1)!.payload.roomCode, 'NEW12');
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Close Room')!.click());
    assert.equal(window.sessionStorage.getItem('jeopardy:host-room:board'), null);
    assert.equal(window.localStorage.getItem('jeopardy:host-room:board'), null);
    assert.deepEqual(emitted.at(-1), { event: E.HOST_END, payload: { roomCode: 'NEW12' } });
  } finally {
    await act(async () => root.unmount());
    gm.deleteSession(state.roomCode);
    globalThis.fetch = originalFetch;
    delete (globalThis as any).__hostSocket;
    dom.window.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
