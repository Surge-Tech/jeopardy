import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as gm from '../src/socket/gameManager.js';

test('question countdown counts only open buzzer time and survives refresh and repeated wrong answers', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const session = gm.createSession('board');
  gm.setMode(session.roomCode, 'individual');
  const room = session.roomCode;
  const first = gm.addPlayer(room, 'First', '#ff0000')!;
  const second = gm.addPlayer(room, 'Second', '#00ff00')!;
  try {
    gm.startGame(room);
    gm.openQuestion(room, 'question', false);
    gm.revealClue(room);
    gm.recordBuzz(room, first.id, first.name, null); // Early buzz does not start a timer.
    assert.equal(session.questionTimer, null);
    now += 1000;
    gm.enableBuzzer(room);
    assert.deepEqual(session.questionTimer, { remainingMs: 30000, deadline: 131000, serverNow: now });
    now += 10000;
    gm.enableBuzzer(room); // Reopening an already-open buzzer must not reset the budget.
    assert.equal(session.questionTimer?.deadline, 131000);
    gm.recordBuzz(room, first.id, first.name, now);
    assert.deepEqual(session.questionTimer, { remainingMs: 20000, deadline: null, serverNow: now });
    now += 15000;
    assert.equal(gm.getSession(room)?.questionTimer?.remainingMs, 20000);
    gm.markWrongAndReopen(room, first.id, -200);
    assert.equal(session.questionTimer?.deadline, now + 20000);
    now += 5000;
    gm.recordBuzz(room, second.id, second.name, now);
    assert.equal(session.questionTimer?.remainingMs, 15000);
    now += 5000;
    gm.markWrongAndReopen(room, second.id, -200);
    assert.equal(session.questionTimer?.deadline, now + 15000);
    now += 20000;
    const snapshot = gm.getSession(room)!;
    assert.equal(snapshot.buzzerState, 'open');
    assert.equal(snapshot.responseVisible, false);
    assert.equal(snapshot.activeQuestionId, 'question');
    gm.lockBuzzer(room);
    assert.equal(session.questionTimer?.remainingMs, 0);
    gm.enableBuzzer(room);
    assert.equal(session.questionTimer?.deadline, now);
    gm.closeQuestion(room);
    assert.equal(session.questionTimer, null);
    gm.openQuestion(room, 'next', false);
    gm.revealClue(room, 'image');
    assert.equal(session.questionTimer?.deadline, now + 30000);
    now += 5000;
    gm.lockBuzzer(room);
    now += 10000;
    gm.enableBuzzer(room);
    assert.equal(session.questionTimer?.deadline, now + 25000);
    gm.showResponse(room);
    assert.equal(session.questionTimer?.deadline, null);
    assert.equal(session.questionTimer?.remainingMs, 25000);
    gm.resetBuzzer(room);
    assert.equal(session.questionTimer?.deadline, null);
    gm.closeQuestion(room);
    gm.openQuestion(room, 'daily-double', true);
    assert.equal(session.questionTimer, null);
  } finally {
    gm.deleteSession(room);
  }
});
