import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as gm from '../src/socket/gameManager.js';

for (const mediaType of ['image', 'audio', 'video', 'youtube'] as const) {
  test(`${mediaType} clues accept a buzz immediately on reveal`, () => {
    const session = gm.createSession('test-board');
    const room = session.roomCode;
    const player = gm.addPlayer(room, 'First', '#ff0000')!;
    try {
      gm.openQuestion(room, 'media-clue', false);
      assert.equal(session.buzzerState, 'idle');
      assert.equal(gm.revealClue(room, mediaType), true);
      assert.equal(session.buzzerState, 'open');
      assert.equal(gm.recordBuzz(room, player.id, player.name, Date.now()), 'won');
      assert.equal(session.buzzerState, 'locked');
      assert.equal(gm.revealClue(room, mediaType), false);
      assert.equal(session.buzzedPlayerId, player.id);
      gm.markWrongAndReopen(room, player.id, -200);
      assert.equal(gm.resetBuzzer(room), true);
      assert.equal(session.buzzerState, 'open');
      assert.equal(session.buzzedPlayerId, null);
    } finally {
      gm.deleteSession(room);
    }
  });
}

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

test('an unresolved buzz blocks closing or replacing the question until judged', () => {
  const session = gm.createSession('test-board');
  const room = session.roomCode;
  const first = gm.addPlayer(room, 'First', '#ff0000')!;
  const second = gm.addPlayer(room, 'Second', '#00ff00')!;
  try {
    gm.openQuestion(room, 'clue', false);
    gm.revealClue(room);
    gm.enableBuzzer(room);
    assert.equal(gm.recordBuzz(room, first.id, first.name, Date.now()), 'won');
    assert.equal(gm.recordBuzz(room, second.id, second.name, Date.now()), 'queued');
    gm.showResponse(room);
    assert.equal(gm.closeQuestion(room), false);
    assert.equal(gm.openQuestion(room, 'other', false), false);
    assert.equal(gm.enableBuzzer(room), false);
    assert.equal(session.activeQuestionId, 'clue');
    assert.deepEqual(session.answeredQuestions, []);
    gm.markWrongAndReopen(room, first.id, -200);
    const next = gm.getNextInQueue(room, new Set([first.id]))!;
    gm.advanceToBuzzEntry(room, next);
    assert.equal(gm.closeQuestion(room), false);
    gm.recordOutcome(room, second.id, 'correct');
    assert.equal(gm.closeQuestion(room), true);
    assert.deepEqual(session.answeredQuestions, ['clue']);
  } finally {
    gm.deleteSession(room);
  }
});


test('reset cancels a pending answer and queue without scoring, then accepts a fresh buzz', () => {
  const session = gm.createSession('test-board');
  const room = session.roomCode;
  const first = gm.addPlayer(room, 'First', '#ff0000')!;
  const second = gm.addPlayer(room, 'Second', '#00ff00')!;
  try {
    gm.openQuestion(room, 'clue', false);
    gm.revealClue(room);
    gm.enableBuzzer(room);
    gm.recordBuzz(room, first.id, first.name, Date.now());
    gm.recordBuzz(room, second.id, second.name, Date.now());
    assert.equal(gm.resetBuzzer(room), true);
    assert.equal(session.buzzerState, 'open');
    assert.equal(session.buzzedPlayerId, null);
    assert.equal(session.buzzedPlayerName, null);
    assert.equal(session.buzzTimestamp, null);
    assert.equal(session.answerTimer, null);
    assert.deepEqual(session.buzzQueue, []);
    assert.equal(session.activeQuestionId, 'clue');
    assert.deepEqual(session.answeredQuestions, []);
    assert.equal(first.score, 0);
    assert.equal(second.score, 0);
    assert.equal(first.stats?.correct ?? 0, 0);
    assert.equal(first.stats?.wrong ?? 0, 0);
    assert.equal(gm.recordBuzz(room, first.id, first.name, Date.now()), 'won');
    gm.markWrongAndReopen(room, first.id, -200);
    gm.resetBuzzer(room);
    assert.equal(gm.recordBuzz(room, first.id, first.name, Date.now()), 'locked-out');
    assert.equal(gm.recordBuzz(room, second.id, second.name, Date.now()), 'won');
  } finally {
    gm.deleteSession(room);
  }
});
