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
import * as gm from '../../backend/src/socket/gameManager';

test('projected Daily Double waits for activation before announcing or showing the clue', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.dd-preview-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const handlers = new Map<string, (...args: any[]) => void>();
  let announcements = 0;
  (globalThis as any).__previewSocket = {
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event), emit: () => {},
  };
  (globalThis as any).__previewAnnouncement = () => { announcements++; };
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'board', name: 'Test board', rounds: [{ id: 'round', pointValues: [200], categories: [{
      id: 'category', name: 'Category', questions: [{ id: 'dd', value: 200, clue: 'Secret clue', response: 'Secret answer', isDailyDouble: true }],
    }] }],
  }));
  const root = createRoot(document.getElementById('root')!);
  const state = gm.createSession('board');
  try {
    await build({
      entryPoints: [join(testDir, '../src/pages/BoardView.tsx')], outfile: join(tempDir, 'board.mjs'),
      bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'preview-dependencies', setup(builder) {
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__previewSocket;', loader: 'js' }));
        builder.onResolve({ filter: /\/utils\/sounds$/ }, () => ({ path: 'sounds', namespace: 'sounds' }));
        builder.onLoad({ filter: /.*/, namespace: 'sounds' }, () => ({ contents: `export const playDailyDouble = globalThis.__previewAnnouncement;
          export const playBuzzerReady = () => {}; export const playBuzzIn = () => {}; export const playWrong = () => {};
          export const playTick = () => {}; export const playTimesUp = () => {}; export const playFinalJeopardy = () => {};
          export const playReveal = () => {}; export const playWinnerFanfare = () => {}; export const enableSounds = async () => {}; export const playThinkingPulse = () => {}; export const stopThinkingPulse = () => {};`, loader: 'js' }));
      } }],
    });
    const { default: BoardView } = await import(pathToFileURL(join(tempDir, 'board.mjs')).href);
    gm.setMode(state.roomCode, 'individual');
    const player = gm.addPlayer(state.roomCode, 'Player', '#ffffff')!;
    gm.startGame(state.roomCode);
    await act(async () => root.render(<MemoryRouter initialEntries={[`/board/${state.roomCode}`]}><Routes>
      <Route path="/board/:roomCode" element={<BoardView />} />
    </Routes></MemoryRouter>));
    const update = () => act(async () => handlers.get('game:state')!(structuredClone(state)));
    gm.openQuestion(state.roomCode, 'dd', true);
    await update();
    assert.doesNotMatch(document.body.textContent!, /DOUBLE!|Secret clue/);
    assert.equal(announcements, 0);
    gm.openQuestion(state.roomCode, 'other', false);
    await update();
    assert.deepEqual(state.answeredQuestions, []);
    gm.openQuestion(state.roomCode, 'dd', true);
    await update();
    gm.startDailyDoubleWager(state.roomCode, player.id, 200, false);
    await update();
    assert.match(document.body.textContent!, /DOUBLE!/);
    assert.doesNotMatch(document.body.textContent!, /Secret clue/);
    assert.equal(announcements, 1);
    gm.overrideDDWager(state.roomCode, 100);
    await update();
    assert.equal(announcements, 1, 'wager updates do not replay the announcement');
    gm.revealDailyDouble(state.roomCode);
    await update();
    assert.match(document.body.textContent!, /Secret clue/);
    assert.equal(document.querySelector('.dd-reveal'), null);
  } finally {
    await act(async () => root.unmount());
    gm.deleteSession(state.roomCode);
    Object.assign(globalThis, old);
    delete (globalThis as any).__previewSocket;
    delete (globalThis as any).__previewAnnouncement;
    dom.window.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
