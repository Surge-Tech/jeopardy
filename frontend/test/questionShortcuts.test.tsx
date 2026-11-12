import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getQuestionShortcut } from '../src/utils/questionShortcuts';

for (const [key, action] of [['n', 'wrong'], ['y', 'correct']] as const) {
  test(`${key.toUpperCase()} judges only a pending, locked buzz ${action}`, () => {
    const state = { clueVisible: true, responseVisible: false, buzzerState: 'locked' as 'idle' | 'open' | 'locked',
      buzzedPlayerId: 'player' as string | null, buzzHistory: [{ playerId: 'player', playerName: 'Player', reactionMs: 50, attemptedAnswer: false }] };
    const n = { code: `Key${key.toUpperCase()}`, key };
    assert.equal(getQuestionShortcut(n, state), action);
    assert.equal(getQuestionShortcut({ code: `Key${key.toUpperCase()}`, key: key.toUpperCase() }, state), action);
    state.responseVisible = true;
    assert.equal(getQuestionShortcut(n, state), action);
    state.buzzHistory[0].attemptedAnswer = true;
    assert.equal(getQuestionShortcut(n, state), null);
    state.buzzHistory[0].attemptedAnswer = false;
    state.buzzerState = 'open';
    assert.equal(getQuestionShortcut(n, state), null);
    state.buzzerState = 'idle';
    assert.equal(getQuestionShortcut(n, state), null);
    state.buzzerState = 'locked';
    state.buzzedPlayerId = null;
    assert.equal(getQuestionShortcut(n, state), null);
  });
}

test('Space reveals, opens buzzers, then closes only after the response is shown', () => {
  const space = { code: 'Space', key: ' ' };
  const state = { buzzedPlayerId: null, buzzHistory: [], clueVisible: false, responseVisible: false, buzzerState: 'idle' as 'idle' | 'open' | 'locked' };
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
  assert.equal(getQuestionShortcut({ code: 'Space', key: ' ' }, { buzzedPlayerId: null, buzzHistory: [], clueVisible: true, responseVisible: true, buzzerState: 'idle' }), 'close');
  assert.equal(getQuestionShortcut({ code: 'KeyR', key: 'r' }, { buzzedPlayerId: null, buzzHistory: [], clueVisible: false, responseVisible: false, buzzerState: 'idle' }), null);
});

test('Space cannot close a response while the buzzed-in player is awaiting judgment', () => {
  const state = { clueVisible: true, responseVisible: true, buzzerState: 'locked' as const,
    buzzedPlayerId: 'player', buzzHistory: [{ playerId: 'player', playerName: 'Player', reactionMs: 50, attemptedAnswer: false }] };
  const space = { code: 'Space', key: ' ' };
  assert.equal(getQuestionShortcut(space, state), null);
  state.buzzHistory[0].attemptedAnswer = true;
  assert.equal(getQuestionShortcut(space, state), 'close');
});
