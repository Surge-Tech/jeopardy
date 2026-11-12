import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import type { GameState } from '../../backend/src/shared/types';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('host team controls, shared standings and captain-only Final Jeopardy screens', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.teams-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { createRoot } = await import('react-dom/client');
  const emitted: Array<{ event: string; payload: any }> = [];
  (globalThis as any).__teamSocket = {
    on: () => {}, off: () => {},
    emit: (event: string, payload: any, ack?: (r: any) => void) => {
      emitted.push({ event, payload });
      ack?.({ ok: true });
    },
  };
  await build({
    stdin: {
      contents: `
        export { default as TeamsPanel } from './components/host/TeamsPanel';
        export { default as PlayerFinal } from './components/final/PlayerFinal';
        export { default as DDHostPanel } from './components/dailydouble/DDHostPanel';
        export { buildRows } from './components/shared/Leaderboard';
      `,
      resolveDir: join(testDir, '../src'), loader: 'tsx',
    },
    outfile: join(tempDir, 'teams.mjs'), bundle: true, platform: 'node',
    format: 'esm', packages: 'external', jsx: 'automatic',
    tsconfig: join(testDir, '../tsconfig.json'),
    plugins: [{ name: 'test-socket', setup(builder) {
      builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
        contents: 'export const socket = globalThis.__teamSocket;', loader: 'js',
      }));
    } }],
  });
  const { TeamsPanel, PlayerFinal, DDHostPanel, buildRows } = await import(pathToFileURL(join(tempDir, 'teams.mjs')).href);
  const root = createRoot(document.getElementById('root')!);
  const state = {
    mode: 'teams', phase: 'lobby', roomCode: 'TEAM', activeQuestionId: null,
    buzzedPlayerId: null, buzzHistory: [],
    players: [
      { id: 'alice', name: 'Alice', teamId: 'blue', color: '#ffffff', score: 0, stats: { correct: 1, wrong: 0, buzzes: 1, earlyBuzzes: 0 } },
      { id: 'bob', name: 'Bob', teamId: 'blue', color: '#ffffff', score: 0 },
      { id: 'carol', name: 'Carol', teamId: 'red', color: '#ffffff', score: 0 },
    ],
    teams: [
      { id: 'blue', name: 'Blue', score: 1200, color: '#0000ff', captainPlayerId: 'alice' },
      { id: 'red', name: 'Red', score: 1000, color: '#ff0000', captainPlayerId: 'carol' },
    ],
    finalJeopardy: null, dailyDouble: null,
  } as unknown as GameState;
  async function render(node: React.ReactNode) { await act(async () => root.render(node)); }
  function button(text: string): HTMLButtonElement {
    const found = [...document.querySelectorAll('button')].find(b => b.textContent === text);
    assert.ok(found, `Button ${text} exists`);
    return found;
  }
  try {
    await render(<TeamsPanel gameState={state} roomCode="TEAM" />);
    assert.match(document.body.textContent!, /Setup locks when play starts/);
    assert.equal(button('Auto-assign players').disabled, false);
    await act(async () => button('Auto-assign players').click());
    assert.deepEqual(emitted.at(-1), { event: E.HOST_AUTO_ASSIGN_TEAMS, payload: { roomCode: 'TEAM' } });
    await render(<TeamsPanel gameState={{ ...state, teams: state.teams.slice(0, 1) }} roomCode="TEAM" />);
    assert.equal(button('Auto-assign players').disabled, true);
    assert.match(document.body.textContent!, /Create at least two teams/);
    await render(<TeamsPanel gameState={{ ...state, players: state.players.slice(0, 1) }} roomCode="TEAM" />);
    assert.equal(button('Auto-assign players').disabled, true);
    assert.match(document.body.textContent!, /Add enough players/);
    await render(<TeamsPanel gameState={state} roomCode="TEAM" />);
    const assignment = document.querySelector('[aria-label="Team for Bob"]') as HTMLSelectElement;
    await act(async () => {
      assignment.value = 'red';
      assignment.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    });
    assert.deepEqual(emitted.at(-1), { event: E.HOST_ASSIGN_TEAM, payload: { roomCode: 'TEAM', playerId: 'bob', teamId: 'red' } });
    await act(async () => button('Start game').click());
    assert.equal(emitted.at(-1)?.event, E.HOST_START);
    await render(<TeamsPanel gameState={{ ...state, phase: 'playing' }} roomCode="TEAM" />);
    assert.equal([...document.querySelectorAll('button')].some(b => b.textContent === 'Auto-assign players'), false);
    assert.equal(document.querySelector('[aria-label="Game mode"]'), null);
    assert.equal(document.querySelector('[aria-label="Team for Bob"]'), null);
    assert.equal(document.querySelector('[aria-label="Captain for Blue"]')?.hasAttribute('disabled'), false);
    await act(async () => button('+100').click());
    assert.deepEqual(emitted.at(-1), { event: E.HOST_SCORE, payload: { roomCode: 'TEAM', playerId: 'blue', delta: 100 } });

    const rows = buildRows(state);
    assert.deepEqual(rows.map((r: any) => [r.name, r.finalScore]), [['Blue', 1200], ['Red', 1000]]);
    assert.equal(rows[0].correct, 1);
    const finalState = {
      ...state, phase: 'playing',
      finalJeopardy: {
        stage: 'wagering', category: 'Science', clue: null, deadline: null, serverNow: Date.now(),
        contestants: state.teams.map(t => ({ playerId: t.id, playerName: t.name, preScore: t.score, maxWager: t.score, hasWagered: false, hasAnswered: false })),
        revealed: {}, revealIndex: 0, revealStep: 'name', currentReveal: null, response: null,
      },
    } as GameState;
    await render(<PlayerFinal gameState={finalState} myId="bob" />);
    assert.equal(document.querySelector('input'), null);
    assert.match(document.body.textContent!, /Your captain submits/);
    await render(<PlayerFinal gameState={finalState} myId="alice" />);
    assert.ok(document.querySelector('input'));
    const transferred = { ...finalState, teams: finalState.teams.map(t => t.id === 'blue' ? { ...t, captainPlayerId: 'bob' } : t) };
    await render(<PlayerFinal gameState={transferred} myId="alice" />);
    assert.equal(document.querySelector('input'), null);
    await render(<PlayerFinal gameState={transferred} myId="bob" />);
    assert.ok(document.querySelector('input'));
    const wagerLocked = { ...transferred, finalJeopardy: { ...transferred.finalJeopardy!, contestants: transferred.finalJeopardy!.contestants.map(c => ({ ...c, hasWagered: true })) } };
    await render(<PlayerFinal gameState={wagerLocked} myId="bob" />);
    assert.match(document.body.textContent!, /Wager locked/);
    assert.doesNotMatch(document.body.textContent!, /Wager locked: 1200/);
    const answering = { ...transferred, finalJeopardy: { ...transferred.finalJeopardy!, stage: 'answering', clue: 'The clue' } } as GameState;
    await render(<PlayerFinal gameState={answering} myId="bob" />);
    assert.ok(document.querySelector('textarea'));
    await render(<PlayerFinal gameState={answering} myId="alice" />);
    assert.equal(document.querySelector('textarea'), null);
    assert.match(document.body.textContent!, /The clue/);
    const finalRows = buildRows({ ...transferred, teams: transferred.teams.map(t => ({ ...t, score: 1700 })) });
    assert.equal(finalRows.length, 2);
    assert.equal(finalRows[0].finalScore, 1700);
    assert.equal(finalRows[0].tied, true);

    const picks: string[] = [];
    const ddState = { ...state, dailyDouble: { stage: 'ready', playerId: 'alice', maxWager: 1200, wager: 500, boardHighValue: 1000, hasDevice: true, submittedByPlayer: true }, dailyDoubleRevealed: true } as GameState;
    await render(<DDHostPanel gameState={ddState} roomCode="TEAM" activeQ={{ id: 'q', value: 200, clue: 'Clue', response: 'Answer' }}
      onAward={(id: string) => picks.push(id)} onReveal={() => {}} onClose={() => {}} />);
    assert.match(document.body.textContent!, /Blue/);
    await act(async () => button('✓ Correct').click());
    assert.deepEqual(picks, ['alice']);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete (globalThis as any).__teamSocket;
    await rm(tempDir, { recursive: true, force: true });
  }
});
