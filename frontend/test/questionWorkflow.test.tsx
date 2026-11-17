import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import ActiveQuestionPanel from '../src/components/host/ActiveQuestionPanel';
import type { ComponentProps } from 'react';

test('question actions follow selection, reveal, buzzing, judgment, answer and close, including no answers', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const events: string[] = [];
  const props: ComponentProps<typeof ActiveQuestionPanel> = {
    activeQ: { id: 'question', value: 200, clue: 'A clue', response: 'The answer' },
    clueVisible: false, responseVisible: false, buzzerState: 'idle', buzzWinner: null,
    buzzWinnerId: null, buzzedPlayerId: null, players: [], buzzLockouts: {}, buzzHistory: [],
    onRevealClue: () => events.push('reveal'), onEnableBuzzer: () => events.push('open'),
    onShowAnswer: () => events.push('answer'), onClose: () => events.push('close'),
    onAward: id => events.push(`accept:${id}`), onMarkWrong: id => events.push(`reject:${id}`),
    onLockBuzzer: () => events.push('lock'), onResetBuzzer: () => events.push('reset'),
  };
  const render = async () => act(async () => root.render(<ActiveQuestionPanel {...props} />));
  const actions = () => document.querySelector('[aria-label="Question actions"]')!;
  const primary = () => actions().querySelector('button')!;
  const status = () => document.querySelector('[aria-label="Question status"]')!.textContent!;
  const click = async () => act(async () => primary().click());
  try {
    await render();
    assert.match(primary().textContent!, /Show Clue/);
    assert.match(status(), /Card selected/);
    const sections = [...document.querySelectorAll('section')].map(el => el.getAttribute('aria-label'));
    assert.deepEqual(sections, ['Question actions', 'Question status', 'Question information']);
    await click();
    props.clueVisible = true;
    await render();
    assert.match(primary().textContent!, /Open Buzzers/);
    await click();
    props.buzzerState = 'open';
    await render();
    assert.match(primary().textContent!, /Show Answer/);
    assert.match(status(), /Waiting for a buzz/);
    assert.ok(actions().querySelector('details button'), 'recovery controls remain available');

    // No buzz: reveal the answer and close directly.
    await click();
    props.responseVisible = true;
    await render();
    assert.match(primary().textContent!, /Close Question/);
    assert.match(status(), /Answer on board/);
    await click();
    assert.deepEqual(events, ['reveal', 'open', 'answer', 'close']);

    // A pending buzz replaces reveal/close with judging. Reject returns to waiting.
    props.responseVisible = false;
    props.buzzerState = 'locked';
    props.buzzWinner = 'Per'; props.buzzWinnerId = props.buzzedPlayerId = 'per';
    props.buzzHistory = [{ playerId: 'per', playerName: 'Per', reactionMs: 50, attemptedAnswer: false }];
    await render();
    assert.match(primary().textContent!, /Accept/);
    assert.match(status(), /Per is answering/);
    assert.equal([...actions().querySelectorAll('button')].some(el => el.textContent?.includes('Show Answer')), false);
    assert.equal([...actions().querySelectorAll('button')].find(el => el.textContent === 'Close Question')!.disabled, true);
    await act(async () => [...actions().querySelectorAll('button')].find(el => el.textContent?.includes('Reject'))!.click());
    assert.equal(events.at(-1), 'reject:per');
    props.buzzerState = 'open'; props.buzzedPlayerId = props.buzzWinnerId = props.buzzWinner = null;
    props.buzzHistory[0].attemptedAnswer = true;
    await render();
    assert.match(status(), /Waiting for a buzz/);

    props.buzzerState = 'locked'; props.buzzedPlayerId = props.buzzWinnerId = 'per'; props.buzzWinner = 'Per';
    props.buzzHistory[0].attemptedAnswer = false;
    await render(); await click();
    assert.equal(events.at(-1), 'accept:per');
    props.buzzHistory[0].attemptedAnswer = true;
    await render();
    assert.match(primary().textContent!, /Show Answer/);
    assert.match(status(), /Answer accepted/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close(); Object.assign(globalThis, old);
  }
});
