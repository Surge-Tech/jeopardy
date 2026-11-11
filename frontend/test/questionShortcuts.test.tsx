import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getQuestionShortcut } from '../src/utils/questionShortcuts';

test('Space reveals, opens buzzers, then closes only after the response is shown', () => {
  const space = { code: 'Space', key: ' ' };
  const state = { buzzedPlayerId: null, buzzQueue: [], clueVisible: false, responseVisible: false, buzzerState: 'idle' as 'idle' | 'open' | 'locked' };
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
  assert.equal(getQuestionShortcut({ code: 'Space', key: ' ' }, { buzzedPlayerId: null, buzzQueue: [], clueVisible: true, responseVisible: true, buzzerState: 'idle' }), 'close');
  assert.equal(getQuestionShortcut({ code: 'KeyR', key: 'r' }, { buzzedPlayerId: null, buzzQueue: [], clueVisible: false, responseVisible: false, buzzerState: 'idle' }), null);
});

test('Space cannot close a response while the buzzed-in player is awaiting judgment', () => {
  const state = { clueVisible: true, responseVisible: true, buzzerState: 'locked' as const,
    buzzedPlayerId: 'player', buzzQueue: [{ playerId: 'player', playerName: 'Player', reactionMs: 50, attemptedAnswer: false }] };
  const space = { code: 'Space', key: ' ' };
  assert.equal(getQuestionShortcut(space, state), null);
  state.buzzQueue[0].attemptedAnswer = true;
  assert.equal(getQuestionShortcut(space, state), 'close');
});
