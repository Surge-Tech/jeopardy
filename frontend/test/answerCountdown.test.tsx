import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import type { GameState } from '../../backend/src/shared/types';
import AnswerCountdown from '../src/components/shared/AnswerCountdown';

test('answer countdown uses server time, reaches time up, and disappears after judgment', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = {
    window: globalThis.window, document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  let frame: FrameRequestCallback | undefined;
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: (callback: FrameRequestCallback) => { frame = callback; return 1; },
    cancelAnimationFrame: () => { frame = undefined; },
  });
  const root = createRoot(document.getElementById('root')!);
  const state = {
    buzzedPlayerId: 'first', buzzQueue: [{ playerId: 'first', attemptedAnswer: false }],
    answerTimer: { deadline: 110000, serverNow: 100000 },
  } as GameState;
  try {
    await act(async () => root.render(<AnswerCountdown gameState={state} />));
    assert.equal(document.querySelector('[role=timer]')?.textContent, 'Answer: 10s');
    now += 4000;
    await act(async () => frame!(0));
    assert.equal(document.querySelector('[role=timer]')?.textContent, 'Answer: 6s');
    now += 6000;
    await act(async () => frame!(0));
    assert.equal(document.querySelector('[role=timer]')?.textContent, 'Time’s up!');
    assert.equal(state.buzzQueue[0].attemptedAnswer, false);
    state.buzzQueue[0].attemptedAnswer = true;
    await act(async () => root.render(<AnswerCountdown gameState={state} />));
    assert.equal(document.querySelector('[role=timer]'), null);
    state.buzzQueue[0].attemptedAnswer = false;
    state.answerTimer = null;
    await act(async () => root.render(<AnswerCountdown gameState={state} />));
    assert.equal(document.querySelector('[role=timer]'), null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
