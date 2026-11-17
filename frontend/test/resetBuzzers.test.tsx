import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import ActiveQuestionPanel from '../src/components/host/ActiveQuestionPanel';
import type { Question } from '../../backend/src/shared/types';

test('host can reset an unresolved buzz while closing stays disabled', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  let resets = 0;
  const noop = () => {};
  try {
    await act(async () => root.render(<ActiveQuestionPanel
      activeQ={{ id: 'clue', value: 200, clue: 'Clue', response: 'Answer' } as Question}
      clueVisible responseVisible={false} buzzerState="locked"
      buzzWinner="Per" buzzWinnerId="per" buzzedPlayerId="per"
      players={[]} buzzLockouts={{}}
      buzzHistory={[{ playerId: 'per', playerName: 'Per', reactionMs: 49, attemptedAnswer: false }]}
      onRevealClue={noop} onShowAnswer={noop} onEnableBuzzer={noop} onLockBuzzer={noop}
      onResetBuzzer={() => { resets++; }} onAward={noop} onMarkWrong={noop} onClose={noop}
    />));
    const buttons = Array.from(document.querySelectorAll('button'));
    const reset = buttons.find(button => button.getAttribute('aria-label') === 'Reset Buzzers')!;
    assert.ok(reset);
    assert.equal(reset.disabled, false);
    assert.equal(buttons.find(button => button.textContent?.includes('Close Question'))?.disabled, true);
    await act(async () => reset.click());
    assert.equal(resets, 1);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
