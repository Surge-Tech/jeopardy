import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as gm from '../src/socket/gameManager.js';

test('regular clues must be revealed before buzzers open, and selecting another hides them again', () => {
  const session = gm.createSession('test-board');
  const room = session.roomCode;
  try {
    gm.openQuestion(room, 'first', false);
    assert.equal(session.clueVisible, false);
    assert.equal(session.buzzerState, 'idle');
    assert.equal(gm.enableBuzzer(room), false);
    assert.equal(gm.resetBuzzer(room), false);
    assert.equal(gm.revealClue(room), true);
    assert.equal(session.clueVisible, true);
    assert.equal(session.buzzerState, 'idle');
    assert.equal(gm.enableBuzzer(room), true);
    assert.equal(session.buzzerState, 'open');
    gm.showResponse(room);
    gm.closeQuestion(room);
    assert.equal(session.clueVisible, false);
    assert.equal(gm.enableBuzzer(room), false);
    gm.openQuestion(room, 'second', false);
    assert.equal(session.clueVisible, false);
    assert.equal(session.responseVisible, false);
    assert.equal(session.buzzerState, 'idle');
  } finally {
    gm.deleteSession(room);
  }
});
