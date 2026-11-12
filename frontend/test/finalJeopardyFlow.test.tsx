import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import type { Board, GameState } from '../../backend/src/shared/types';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('Final Jeopardy actions follow wagers, timer, contestant reveals, judgment, response and scoreboard', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.final-flow-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} });
  const sent: { event: string; payload: any }[] = [];
  const handlers = new Map<string, Function>();
  (globalThis as any).__finalFlowSocket = {
    on: (event: string, handler: Function) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (event: string, payload: any) => sent.push({ event, payload }),
  };
  await build({
    entryPoints: [join(testDir, '../src/components/final/HostFinalPanel.tsx')], outfile: join(tempDir, 'panel.mjs'),
    bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
    plugins: [{ name: 'test-socket', setup(builder) {
      builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__finalFlowSocket;', loader: 'js' }));
    } }],
  });
  const { default: Panel } = await import(pathToFileURL(join(tempDir, 'panel.mjs')).href);
  let root = createRoot(document.getElementById('root')!);
  const board = { finalJeopardy: { category: 'Final category', clue: 'Final clue', response: 'Correct answer', timerSeconds: 30 } } as Board;
  const state = { phase: 'playing', mode: 'individual', finalJeopardy: {
    stage: 'intro', category: null, clue: null, deadline: null, serverNow: Date.now(), revealIndex: 0, revealStep: 'name',
    currentReveal: null, revealed: {}, response: null,
    contestants: [
      { playerId: 'per', playerName: 'Per', maxWager: 1000, preScore: 1000, hasWagered: false, hasAnswered: false },
      { playerId: 'anne', playerName: 'Anne', maxWager: 2000, preScore: 2000, hasWagered: false, hasAnswered: false },
    ],
  } } as GameState;
  const fj = state.finalJeopardy!;
  const render = () => act(async () => root.render(<Panel roomCode="FINAL" gameState={structuredClone(state)} board={board} />));
  const primary = () => document.querySelector<HTMLButtonElement>('[aria-label="Question actions"] button')!;
  const status = () => document.querySelector('[aria-label="Question status"]')!.textContent!;
  const key = async (key: string, target: Element = document.body) => act(async () => target.dispatchEvent(new window.KeyboardEvent('keydown', { code: key === ' ' ? 'Space' : `Key${key.toUpperCase()}`, key, bubbles: true, cancelable: true })));
  const expectSent = (event: string, extra = {}) => assert.deepEqual(sent.at(-1), { event, payload: { roomCode: 'FINAL', ...extra } });
  try {
    await render(); expectSent(E.HOST_FJ_GET_STATE);
    assert.deepEqual([...document.querySelectorAll('section')].map(el => el.getAttribute('aria-label')), ['Question actions', 'Question status', 'Question information']);
    assert.match(status(), /Ready for Final Jeopardy/);
    assert.match(document.querySelector('[aria-label="Question information"]')!.textContent!, /Final clue/);
    await key(' '); expectSent(E.HOST_FJ_REVEAL_CATEGORY);
    fj.stage = 'wagering'; await render();
    assert.equal(primary().disabled, true);
    const beforeMissing = sent.length;
    await key(' '); assert.equal(sent.length, beforeMissing, 'Space cannot force missing wagers to zero');
    const force = [...document.querySelectorAll('button')].find(b => b.textContent?.startsWith('Use 0'))!;
    assert.ok(force.closest('details'));
    await act(async () => force.click()); expectSent(E.HOST_FJ_REVEAL_CLUE, { force: true });
    fj.contestants.forEach(c => { c.hasWagered = true; });
    await render(); assert.match(status(), /All wagers are in/);
    await key(' ', document.querySelector('select')!);
    expectSent(E.HOST_FJ_REVEAL_CLUE, { force: true }); // Editing does not run shortcuts.
    await key(' '); expectSent(E.HOST_FJ_REVEAL_CLUE);
    fj.stage = 'clue'; await render();
    await key(' '); expectSent(E.HOST_FJ_START_TIMER);
    fj.stage = 'answering'; fj.deadline = Date.now() + 30000; fj.serverNow = Date.now(); await render();
    assert.ok(document.querySelector('[role="timer"]'));
    const beforeTimer = sent.length;
    await key(' '); assert.equal(sent.length, beforeTimer, 'Space cannot skip the answer timer');
    await act(async () => handlers.get(E.FJ_HOST_STATE)!({ wagers: { per: 500, anne: 1000 }, answers: { per: 'Per answer', anne: 'Anne answer' }, drafts: {} }));
    fj.stage = 'locked'; fj.deadline = null; fj.contestants.forEach(c => { c.hasAnswered = true; }); await render();
    assert.match(status(), /Answers: 2\/2/);
    await key(' '); expectSent(E.HOST_FJ_BEGIN_REVEAL);
    fj.stage = 'reveal'; await render();
    assert.match(status(), /Contestant 1 of 2 · Per/);
    assert.match(status(), /Per answer/);
    await key(' '); expectSent(E.HOST_FJ_REVEAL_STEP);
    fj.revealStep = 'wager'; await render();
    assert.match(primary().textContent!, /Show Contestant Answer/);
    await key(' '); expectSent(E.HOST_FJ_REVEAL_STEP);
    fj.revealStep = 'answer'; await render();
    assert.match(primary().textContent!, /Accept/);
    const beforeJudge = sent.length;
    await key(' '); assert.equal(sent.length, beforeJudge, 'Space cannot judge a contestant');
    await key('y'); expectSent(E.HOST_FJ_JUDGE, { playerId: 'per', correct: true });
    await key('n'); expectSent(E.HOST_FJ_JUDGE, { playerId: 'per', correct: false });
    fj.revealStep = 'judged'; fj.revealed.per = { wager: 500, answer: 'Per answer', correct: true }; await render();
    assert.match(primary().textContent!, /Next Contestant/);
    const undo = [...document.querySelectorAll('button')].find(b => b.textContent === 'Undo Last Judgment')!;
    assert.ok(undo.closest('details'));
    await act(async () => undo.click()); expectSent(E.HOST_FJ_UNDO);
    await key(' '); expectSent(E.HOST_FJ_NEXT);
    fj.revealIndex = 1; fj.revealed.anne = { wager: 1000, answer: 'Anne answer', correct: false }; await render();
    assert.match(primary().textContent!, /Show Correct Answer \(R\)/);
    await key('r'); expectSent(E.HOST_FJ_SHOW_RESPONSE);
    fj.stage = 'response'; await render();
    await key(' '); expectSent(E.HOST_FJ_SCOREBOARD);
    fj.stage = 'final'; await render();
    assert.match(primary().textContent!, /End Game/);
    const returnButton = [...document.querySelectorAll('button')].find(b => b.textContent === 'Return to Board')!;
    await act(async () => returnButton.click()); expectSent(E.HOST_FJ_EXIT);

    // Remounts and host reconnects explicitly refresh private previews.
    await act(async () => root.unmount());
    root = createRoot(document.getElementById('root')!);
    await render(); expectSent(E.HOST_FJ_GET_STATE);
    await act(async () => handlers.get(E.HOST_CREATED)!()); expectSent(E.HOST_FJ_GET_STATE);
    await act(async () => handlers.get(E.FJ_HOST_STATE)!({ wagers: { per: 500 }, answers: { per: 'Restored private answer' }, drafts: {} }));
    assert.match(status(), /Restored private answer/);
  } finally {
    await act(async () => root.unmount()); dom.window.close(); Object.assign(globalThis, old);
    delete (globalThis as any).__finalFlowSocket;
    await rm(tempDir, { recursive: true, force: true });
  }
});
