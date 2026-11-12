import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { PERMANENT_LOCKOUT, type GameState } from '../../backend/src/shared/types';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('wrong-answer lockout survives broadcasts, feedback timers and rejoin, then clears for the next question', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.buzzer-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  });
  // Load React DOM after JSDOM so its input-event support detection uses the DOM.
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const handlers = new Map<string, (...args: any[]) => void>();
  const emitted: string[] = [];
  (globalThis as any).__buzzerSocket = {
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (event: string) => emitted.push(event),
  };
  // Bundle the real component with a controlled socket, without connecting to a server.
  await build({
    entryPoints: [join(testDir, '../src/pages/Buzzer.tsx')],
    outfile: join(tempDir, 'Buzzer.mjs'), bundle: true, platform: 'node',
    format: 'esm', packages: 'external', jsx: 'automatic',
    tsconfig: join(testDir, '../tsconfig.json'),
    plugins: [{ name: 'test-socket', setup(builder) {
      builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const socket = globalThis.__buzzerSocket;', loader: 'js',
      }));
    } }],
  });
  const { default: Buzzer } = await import(pathToFileURL(join(tempDir, 'Buzzer.mjs')).href);
  const root = createRoot(document.getElementById('root')!);
  const timers: Array<() => void> = [];
  async function fire(event: string, payload?: unknown) {
    await act(async () => {
      const original = globalThis.setTimeout;
      // Capture only the component's feedback timers so they can be exercised immediately.
      globalThis.setTimeout = ((callback: () => void) => { timers.push(callback); return 0; }) as any;
      try { handlers.get(event)?.(payload); }
      finally { globalThis.setTimeout = original; }
    });
  }
  const player = { id: 'p1', name: 'Alice', score: 0, color: '#fff' };
  const state = {
    phase: 'playing', players: [player], activeQuestionId: 'q1',
    buzzerState: 'open', buzzLockouts: {}, finalJeopardy: null, dailyDouble: null,
  } as unknown as GameState;
  let stableBuzzer: Element | null = null;
  function assertFeedbackInCircle(text: RegExp) {
    assert.match(document.querySelector('.player-buzz-button [role="status"]')!.textContent!, text);
    assert.equal(document.querySelector('.player-buzzer-dock [role="status"]'), null);
    assert.equal(document.querySelector('.player-buzzer-message, .player-team-notice'), null);
    assert.equal(document.querySelector('.player-buzz-button'), stableBuzzer);
  }
  function assertLocked() {
    assertFeedbackInCircle(/Incorrect answer.*Wait for the next question/);
    assert.equal(document.querySelector('.player-buzz-button'), stableBuzzer);
    assert.match(document.body.textContent!, /Incorrect answer/);
    assert.match(document.body.textContent!, /Wait for the next question/);
    assert.doesNotMatch(document.body.textContent!, /Too slow!|Too early!|YOU BUZZED IN!/);
    const button = document.querySelector<HTMLButtonElement>('.player-buzz-button');
    assert.match(button!.textContent!, /Incorrect answer.*Wait for the next question/);
    assert.ok(button?.disabled);
    const buzzCount = emitted.filter(e => e === E.BUZZ).length;
    button.click();
    assert.equal(emitted.filter(e => e === E.BUZZ).length, buzzCount);
  }
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/buzz/ROOM']}>
        <Routes><Route path="/buzz/:roomCode" element={<Buzzer />} /></Routes>
      </MemoryRouter>,
    ));
    await fire(E.PLAYER_JOINED, { player, state });
    stableBuzzer = document.querySelector('.player-buzz-button');
    assert.ok(stableBuzzer);
    await fire(E.BUZZER_OPEN);
    assert.equal(document.querySelector('.player-buzz-button'), stableBuzzer);
    assert.match(document.body.textContent!, /BUZZ!/);
    await fire(E.BUZZ_WINNER, { playerId: player.id, playerName: player.name });
    await fire(E.GAME_STATE, {
      ...state, buzzerState: 'locked', buzzedPlayerId: player.id, buzzedPlayerName: player.name,
      buzzHistory: [{ playerId: player.id, attemptedAnswer: false }], answerTimer: null,
    });
    assertFeedbackInCircle(/You buzzed in.*Your turn to answer/);
    assert.equal(document.querySelector('.player-buzz-button'), stableBuzzer);
    await act(async () => timers.splice(0).forEach(callback => callback()));
    assertFeedbackInCircle(/You buzzed in.*Your turn to answer/);
    assert.doesNotMatch(document.body.textContent!, /Get ready|Waiting\.\.\./);
    await fire(E.GAME_STATE, {
      ...state, buzzerState: 'locked', buzzedPlayerId: player.id, buzzedPlayerName: player.name,
      buzzHistory: [{ playerId: player.id, attemptedAnswer: false }],
      answerTimer: { deadline: Date.now() + 10000, serverNow: Date.now() },
    });
    assertFeedbackInCircle(/You buzzed in.*Your turn to answer.*10s/);
    assert.ok(stableBuzzer!.querySelector('[aria-label="Answer countdown"]'));

    const lockedState = { ...state, buzzLockouts: { p1: PERMANENT_LOCKOUT } };
    // Same ordering as the server: reopen/winner event, followed by authoritative state.
    await fire(E.BUZZER_OPEN);
    await fire(E.GAME_STATE, lockedState);
    assertLocked();
    await fire(E.BUZZ_WINNER, { playerId: 'p2', playerName: 'Bob' });
    assertLocked();
    await act(async () => timers.splice(0).forEach(callback => callback()));
    assertLocked();
    await fire(E.BUZZER_LOCKED);
    await fire(E.BUZZER_OPEN);
    assertLocked();
    await fire(E.BUZZ_LOCKED_OUT, { until: PERMANENT_LOCKOUT });
    assert.equal(timers.length, 0, 'permanent lockouts must not schedule an overflowing timer');
    await fire(E.PLAYER_JOINED, { player, state: lockedState });
    assertLocked();
    // Rejoining also restores the lockout after the local screen has reset.
    await fire(E.GAME_STATE, { ...state, activeQuestionId: null });
    assert.doesNotMatch(document.body.textContent!, /Incorrect answer/);
    await fire(E.PLAYER_JOINED, { player, state: lockedState });
    assertLocked();
    await fire(E.GAME_STATE, { ...state, activeQuestionId: 'q2', buzzerState: 'idle' });
    assert.doesNotMatch(document.body.textContent!, /Incorrect answer/);
    await fire(E.BUZZER_OPEN);
    const buzz = [...document.querySelectorAll('button')].find(b => b.textContent === 'BUZZ!');
    assert.ok(buzz && !buzz.disabled);
    await act(async () => buzz.click());
    assert.equal(emitted.filter(e => e === E.BUZZ).length, 1);
    // Early-buzz feedback still works for eligible players.
    await fire(E.BUZZ_LOCKED_OUT, { until: Date.now() + 500 });
    assertFeedbackInCircle(/Too early!.*Wait for your buzzer to unlock/);
    assert.equal(document.querySelector('.player-buzz-button'), stableBuzzer);
    await act(async () => timers.splice(0).forEach(callback => callback()));
    assert.match(document.body.textContent!, /Get ready/);
    // Other players can still press during collection, and only see results afterwards.
    await fire(E.BUZZER_OPEN);
    await fire(E.BUZZ_WINNER, { playerId: 'p2', playerName: 'Bob' });
    const collecting = {
      ...state, activeQuestionId: 'q2', buzzerState: 'locked',
      buzzedPlayerId: 'p2', buzzedPlayerName: 'Bob',
      buzzWindow: { deadline: Date.now() + 500, serverNow: Date.now() },
      buzzHistory: [{ playerId: 'p2', playerName: 'Bob', reactionMs: 100, attemptedAnswer: false }],
    };
    await fire(E.GAME_STATE, collecting);
    const lateBuzz = document.querySelector('.player-buzz-button') as HTMLButtonElement;
    assert.equal(lateBuzz.disabled, false);
    assert.equal(document.querySelector('[aria-label="Buzz order"]'), null);
    await act(async () => lateBuzz.click());
    assert.equal(emitted.filter(e => e === E.BUZZ).length, 2);
    await fire(E.BUZZ_RECORDED);
    const results = { ...collecting, buzzWindow: null, buzzHistory: [
      ...collecting.buzzHistory,
      { playerId: player.id, playerName: player.name, reactionMs: 350, attemptedAnswer: false },
    ] };
    await fire(E.GAME_STATE, results);
    assert.equal(lateBuzz.disabled, true);
    assertFeedbackInCircle(/Too slow!.*Bob buzzed in first/);
    assert.equal(document.querySelector('[aria-label="Buzz order"]'), null);
    // Reopening clears the previous results and requires pressing again.
    await fire(E.BUZZER_OPEN);
    await fire(E.GAME_STATE, { ...state, buzzWindow: null, buzzHistory: [], buzzedPlayerId: null });
    assert.equal(lateBuzz.disabled, false);
    assert.equal(document.querySelector('[aria-label="Buzz order"]'), null);
    await fire(E.GAME_STATE, lockedState);
    await fire(E.GAME_ENDED);
    assert.match(document.body.textContent!, /Room Closed/);
    assert.doesNotMatch(document.body.textContent!, /Incorrect answer/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete (globalThis as any).__buzzerSocket;
    await rm(tempDir, { recursive: true, force: true });
  }
});
