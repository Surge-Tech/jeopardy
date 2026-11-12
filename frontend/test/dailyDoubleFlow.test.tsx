import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import * as gm from '../../backend/src/socket/gameManager';

for (const correct of [true, false]) {
  test(`Daily Double ${correct ? 'accept' : 'reject'} follows the host workflow with keyboard controls and survives remount`, async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const tempDir = await mkdtemp(join(testDir, '.dd-flow-'));
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const old = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    await build({
      entryPoints: [join(testDir, '../src/components/dailydouble/DDHostPanel.tsx')], outfile: join(tempDir, 'panel.mjs'),
      bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'test-socket', setup(builder) {
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = { emit() {} };', loader: 'js' }));
      } }],
    });
    const { default: Panel } = await import(pathToFileURL(join(tempDir, 'panel.mjs')).href);
    let root = createRoot(document.getElementById('root')!);
    const state = gm.createSession('board');
    const room = state.roomCode;
    const player = gm.addPlayer(room, 'Per', '#ffffff')!;
    gm.openQuestion(room, 'dd', true);
    gm.startDailyDoubleWager(room, null, 1000, false);
    const events: string[] = [];
    const render = () => act(async () => root.render(<Panel roomCode={room} gameState={structuredClone(state)}
      activeQ={{ id: 'dd', value: 200, clue: 'The clue', response: 'The answer', isDailyDouble: true }}
      onReveal={() => { events.push('reveal'); gm.revealDailyDouble(room); }}
      onAward={(id: string, accepted: boolean) => { events.push(accepted ? 'accept' : 'reject'); gm.recordOutcome(room, id, accepted ? 'correct' : 'wrong'); }}
      onShowAnswer={() => { events.push('answer'); gm.showResponse(room); }}
      onClose={() => { events.push('close'); }} />));
    const primary = () => document.querySelector<HTMLButtonElement>('[aria-label="Question actions"] button')!;
    const status = () => document.querySelector('[aria-label="Question status"]')!.textContent!;
    const key = async (key: string, code = `Key${key.toUpperCase()}`) => act(async () => document.activeElement!.dispatchEvent(new window.KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true })));
    try {
      await render();
      assert.match(status(), /Choose a contestant/);
      assert.match(document.querySelector('[aria-label="Question information"]')!.textContent!, /The clue/);
      assert.deepEqual([...document.querySelectorAll('section')].map(el => el.getAttribute('aria-label')), ['Question actions', 'Question status', 'Question information']);
      gm.pickDDContestant(room, player.id, true);
      await render();
      assert.match(status(), /Waiting for a wager/);
      await key(' ', 'Space');
      assert.deepEqual(events, [], 'Space cannot skip wagering');
      gm.submitDDWager(room, player.id, 500);
      await render();
      assert.match(status(), /Wager: 500/);
      assert.ok(document.activeElement === primary());
      assert.match(primary().textContent!, /Show Clue/);
      await key(' ', 'Space'); await render();
      assert.match(status(), /Per is answering/);
      assert.match(primary().textContent!, /Accept/);
      await key('r');
      assert.deepEqual(events, ['reveal'], 'answer reveal waits for judgment');
      await key(correct ? 'y' : 'n'); await render();
      assert.match(primary().textContent!, /Show Answer/);
      assert.match(status(), correct ? /Answer accepted/ : /Answer rejected/);
      assert.equal(state.activeQuestionId, 'dd', 'reject does not close the question');
      await act(async () => root.unmount());
      root = createRoot(document.getElementById('root')!);
      await render();
      assert.match(primary().textContent!, /Show Answer/, 'judging does not return after remount');
      await key('r'); await render();
      assert.match(status(), /Answer on board/);
      assert.match(primary().textContent!, /Close Question/);
      await key(' ', 'Space');
      assert.deepEqual(events, ['reveal', correct ? 'accept' : 'reject', 'answer', 'close']);
    } finally {
      await act(async () => root.unmount());
      gm.deleteSession(room); dom.window.close(); Object.assign(globalThis, old);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
}
