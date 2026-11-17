import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import type { GameState } from '../../backend/src/shared/types';
import AnswerCountdown from '../src/components/shared/AnswerCountdown';
import BuzzerStatus from '../src/components/shared/BuzzerStatus';

test('answer countdown uses server time, reaches time up, and disappears after judgment', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = {
    window: globalThis.window, document: globalThis.document,
    requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  let cues = 0;
  const param = { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} };
  Object.defineProperty(globalThis, 'AudioContext', { configurable: true, value: class {
    state = 'running';
    currentTime = 0;
    destination = {};
    createGain() { return { gain: { ...param, value: 0 }, connect() {}, disconnect() {} }; }
    createOscillator() {
      return { frequency: param, connect() {}, disconnect() {}, start() { cues++; }, stop() {} };
    }
  } });
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
    players: [],
    buzzedPlayerId: 'first', buzzHistory: [{ playerId: 'first', attemptedAnswer: false }],
    buzzTimestamp: 100000,
    answerTimer: { deadline: 110000, serverNow: 100000 },
  } as GameState;
  try {
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('.answer-clock__number')?.textContent, '10');
    const progress = () => Number(document.querySelector('.answer-clock__progress')?.getAttribute('stroke-dashoffset'));
    const initialProgress = progress();
    now += 16;
    await act(async () => frame!(0));
    const nextProgress = progress();
    assert.ok(nextProgress > initialProgress, 'the ring moves between whole-second ticks');
    assert.equal(document.querySelector('.answer-clock__number')?.textContent, '10');
    now += 16;
    await act(async () => frame!(0));
    assert.ok(progress() > nextProgress, 'the ring continues moving on each animation frame');
    now += 3968;
    await act(async () => frame!(0));
    assert.equal(document.querySelector('.answer-clock__number')?.textContent, '6');
    state.responseVisible = true;
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('[role=timer]'), null);
    assert.equal(frame, undefined, 'revealing the response cancels countdown updates');
    // Exercise expiry separately with a fresh snapshot and the response hidden.
    state.responseVisible = false;
    state.answerTimer!.serverNow = 104000;
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    now += 6000;
    await act(async () => frame!(0));
    assert.match(document.querySelector('[role=timer]')?.textContent ?? '', /Time’s up!/);
    assert.equal(cues, 1, 'the board plays a cue when answer time runs out');
    now += 100;
    await act(async () => frame!(0));
    await act(async () => root.render(<BuzzerStatus gameState={{ ...state }} display />));
    assert.equal(cues, 1, 'frames and state updates do not repeat the cue');
    assert.equal(state.buzzHistory[0].attemptedAnswer, false);
    state.buzzHistory[0].attemptedAnswer = true;
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('[role=timer]'), null);
    state.buzzHistory[0].attemptedAnswer = false;
    state.answerTimer = null;
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('[role=timer]'), null);
    state.dailyDouble = {
      stage: 'ready', playerId: 'first', maxWager: 1000, boardHighValue: 1000,
      wager: 500, hasDevice: true, submittedByPlayer: true,
      timer: { startedAt: 200000, deadline: 215000, serverNow: 200000 },
    };
    state.dailyDoubleRevealed = false;
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('[role=timer]'), null);
    state.dailyDoubleRevealed = true;
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('[aria-label="Daily Double countdown"] .answer-clock__number')?.textContent, '15');
    now += 15000;
    await act(async () => frame!(0));
    assert.match(document.querySelector('[role=timer]')?.textContent ?? '', /Time’s up!/);
    assert.equal(cues, 2, 'Daily Double expiry plays the same cue');
    state.dailyDouble.outcome = 'correct';
    await act(async () => root.render(<BuzzerStatus gameState={state} display />));
    assert.equal(document.querySelector('[role=timer]'), null);
    assert.equal(cues, 2, 'judgment and response reveal do not play timeout cues');
    state.dailyDouble = null;
    state.answerTimer = { deadline: 320000, serverNow: 310000 };
    await act(async () => root.render(<AnswerCountdown gameState={state} />));
    now += 10000;
    await act(async () => frame!(0));
    assert.equal(cues, 2, 'host and player countdowns stay silent by default');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
    if (originalAudioContext) Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
    else Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});
