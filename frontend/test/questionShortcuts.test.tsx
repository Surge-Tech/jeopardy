import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getQuestionShortcut } from '../src/utils/questionShortcuts';

test('Space reveals, opens buzzers, then closes only after the response is shown', () => {
  const space = { code: 'Space', key: ' ' };
  const state = { clueVisible: false, responseVisible: false, buzzerState: 'idle' as 'idle' | 'open' | 'locked' };
  assert.equal(getQuestionShortcut(space, state), 'reveal');
  state.clueVisible = true;
  assert.equal(getQuestionShortcut(space, state), 'open');
  state.buzzerState = 'open';
  assert.equal(getQuestionShortcut(space, state), null);
  state.buzzerState = 'locked';
  assert.equal(getQuestionShortcut(space, state), null);
  assert.equal(getQuestionShortcut({ code: 'KeyR', key: 'r' }, state), 'response');
  state.responseVisible = true;
  assert.equal(getQuestionShortcut(space, state), 'close');
  assert.equal(getQuestionShortcut({ code: 'KeyR', key: 'R' }, state), null);
});

test('Space closes a revealed response even with idle buzzers, and R cannot reveal a hidden clue', () => {
  assert.equal(getQuestionShortcut({ code: 'Space', key: ' ' }, { clueVisible: true, responseVisible: true, buzzerState: 'idle' }), 'close');
  assert.equal(getQuestionShortcut({ code: 'KeyR', key: 'r' }, { clueVisible: false, responseVisible: false, buzzerState: 'idle' }), null);
});
