import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as gm from '../src/socket/gameManager.js';

test('answer countdown starts on winning buzz, resets for the next contestant, and stops on judgment', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const session = gm.createSession('board');
  const room = session.roomCode;
  const first = gm.addPlayer(room, 'First', '#ff0000')!;
  const second = gm.addPlayer(room, 'Second', '#00ff00')!;
  try {
    assert.equal(session.settings.answerTimeS, 10);
    gm.openQuestion(room, 'question', false);
    gm.revealClue(room, 'video');
    assert.equal(session.answerTimer, null);
    gm.setAnswerTime(room, 15);
    assert.equal(gm.recordBuzz(room, first.id, first.name, now), 'won');
    assert.deepEqual(session.answerTimer, { deadline: 115000, serverNow: now });
    now += 2000;
    assert.equal(gm.recordBuzz(room, second.id, second.name, now), 'queued');
    assert.equal(session.answerTimer?.deadline, 115000);
    gm.getSession(room);
    assert.equal(session.answerTimer?.serverNow, now);
    gm.setAnswerTime(room, 5);
    assert.equal(session.answerTimer?.deadline, 115000);
    now = 120000;
    // Expiry leaves judging and the buzz queue under host control.
    assert.equal(gm.getSession(room)?.buzzedPlayerId, first.id);
    assert.equal(gm.closeQuestion(room), false);
    gm.markWrongAndReopen(room, first.id, -200);
    assert.equal(session.answerTimer, null);
    const next = gm.getNextInQueue(room, new Set([first.id]))!;
    gm.advanceToBuzzEntry(room, next);
    assert.deepEqual(session.answerTimer, { deadline: 125000, serverNow: now });
    gm.recordOutcome(room, second.id, 'correct');
    assert.equal(session.answerTimer, null);
    gm.closeQuestion(room);
    gm.openQuestion(room, 'next', false);
    gm.setAnswerTime(room, 0);
    gm.revealClue(room, 'image');
    assert.equal(gm.recordBuzz(room, first.id, first.name, now), 'won');
    assert.equal(session.answerTimer, null);
    gm.recordOutcome(room, first.id, 'correct');
    gm.resetBuzzer(room);
    assert.equal(session.answerTimer, null);
  } finally {
    gm.deleteSession(room);
  }
});

test('revealing the response stops the countdown and keeps it stopped for later buzzes on that clue', () => {
  const session = gm.createSession('board');
  const room = session.roomCode;
  const first = gm.addPlayer(room, 'First', '#ff0000')!;
  const second = gm.addPlayer(room, 'Second', '#00ff00')!;
  try {
    gm.openQuestion(room, 'question', false);
    gm.revealClue(room, 'video');
    gm.recordBuzz(room, first.id, first.name, Date.now());
    gm.recordBuzz(room, second.id, second.name, Date.now());
    assert.ok(session.answerTimer);
    assert.equal(gm.showResponse(room), true);
    assert.equal(session.responseVisible, true);
    assert.equal(session.answerTimer, null);
    assert.equal(session.buzzedPlayerId, first.id);
    assert.equal(session.buzzQueue[0].attemptedAnswer, false);
    gm.markWrongAndReopen(room, first.id, -200);
    gm.advanceToBuzzEntry(room, gm.getNextInQueue(room, new Set([first.id]))!);
    assert.equal(session.answerTimer, null);
    gm.resetBuzzer(room);
    gm.recordBuzz(room, second.id, second.name, Date.now());
    assert.equal(session.answerTimer, null);
    gm.recordOutcome(room, second.id, 'correct');
    gm.closeQuestion(room);
    gm.openQuestion(room, 'next', false);
    gm.revealClue(room, 'image');
    gm.recordBuzz(room, first.id, first.name, Date.now());
    assert.ok(session.answerTimer);
  } finally {
    gm.deleteSession(room);
  }
});

test('answer time accepts only whole seconds from 0 through 120', () => {
  const session = gm.createSession('board');
  try {
    for (const value of [-1, 121, 1.5, NaN, Infinity, '5', null]) {
      assert.equal(gm.setAnswerTime(session.roomCode, value as number), false);
      assert.equal(session.settings.answerTimeS, 10);
    }
    for (const value of [0, 1, 30, 120]) {
      assert.equal(gm.setAnswerTime(session.roomCode, value), true);
      assert.equal(session.settings.answerTimeS, value);
    }
  } finally {
    gm.deleteSession(session.roomCode);
  }
});
