import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import type { GameState } from '../../backend/src/shared/types';
import QuestionCountdown from '../src/components/host/QuestionCountdown';

test('host question countdown pauses, resumes, and remains at zero without taking action', async t => {
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
    activeQuestionId: 'question',
    questionTimer: { remainingMs: 30000, deadline: 130000, serverNow: 100000 },
  } as GameState;
  const render = () => act(async () => root.render(<QuestionCountdown gameState={state} />));
  const display = () => document.querySelector('[role=timer] .answer-clock__number')?.textContent;
  const progress = () => Number(document.querySelector('.answer-clock__progress')?.getAttribute('stroke-dashoffset'));
  try {
    await render();
    assert.equal(display(), '30');
    assert.equal(progress(), 0);
    now += 20000;
    await act(async () => frame!(0));
    assert.equal(display(), '10');
    assert.ok(Math.abs(progress() - 100 * 2 / 3) < 0.001);
    state.questionTimer = { remainingMs: 10000, deadline: null, serverNow: 120000 };
    await render();
    now += 15000;
    assert.equal(frame, undefined);
    assert.equal(display(), '10');
    assert.ok(Math.abs(progress() - 100 * 2 / 3) < 0.001);
    assert.match(document.body.textContent!, /Paused/);
    state.questionTimer = { remainingMs: 10000, deadline: 145000, serverNow: 135000 };
    await render();
    assert.equal(display(), '10');
    now += 11000;
    await act(async () => frame!(0));
    assert.equal(display(), '0');
    assert.equal(progress(), 100);
    assert.ok(document.querySelector('.answer-clock--urgent'));
    assert.equal(state.activeQuestionId, 'question');
    assert.match(document.body.textContent!, /Time elapsed/);
    state.responseVisible = true;
    await render();
    assert.equal(display(), undefined);
    state.responseVisible = false;
    state.dailyDouble = {} as NonNullable<GameState['dailyDouble']>;
    await render();
    assert.equal(display(), undefined);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
