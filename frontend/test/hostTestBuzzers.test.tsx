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

test('host test buzzers are opt-in, send the selected identity, explain lockouts and unlock when penalties expire', async t => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.host-buzz-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  let refresh: () => void = () => {};
  t.mock.method(dom.window, 'setInterval', (callback: () => void) => { refresh = callback; return 1; });
  let cleared = false;
  t.mock.method(dom.window, 'clearInterval', () => { cleared = true; });
  const { createRoot } = await import('react-dom/client');
  const emitted: Array<{ event: string; payload: any }> = [];
  let response: any = { ok: true, outcome: 'early' };
  (globalThis as any).__hostBuzzSocket = { emit: (event: string, payload: any, ack: (res: any) => void) => {
    emitted.push({ event, payload }); ack(response);
  } };
  await build({
    entryPoints: [join(testDir, '../src/components/host/PlayersTab.tsx')],
    outfile: join(tempDir, 'PlayersTab.mjs'), bundle: true, platform: 'node',
    format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
    plugins: [{ name: 'test-socket', setup(builder) {
      builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
      builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__hostBuzzSocket;', loader: 'js' }));
    } }],
  });
  const { default: PlayersTab } = await import(pathToFileURL(join(tempDir, 'PlayersTab.mjs')).href);
  const root = createRoot(document.getElementById('root')!);
  const player = { id: 'admin-player', name: 'Alice', score: 0, color: '#ffffff' };
  const state = {
    phase: 'playing', mode: 'individual', teams: [], players: [player], activeQuestionId: null,
    buzzerState: 'idle', buzzLockouts: {}, buzzHistory: [], buzzWindow: null, dailyDouble: null, finalJeopardy: null,
  } as unknown as GameState;
  const props = {
    roomCode: 'ROOM', players: [player], addPlayerName: '', onAddPlayerNameChange: () => {}, onAddPlayer: () => {},
    renamingPlayerId: null, renameValue: '', onRenameValueChange: () => {}, renameError: '', onStartRename: () => {},
    onCancelRename: () => {}, onSaveRename: () => {}, onAdjustScore: () => {}, onRemovePlayer: () => {},
  };
  async function render(gameState: GameState) { await act(async () => root.render(<PlayersTab {...props} gameState={gameState} />)); }
  const buzz = () => document.querySelector('[aria-label="Test buzzer for Alice"]') as HTMLButtonElement;
  const toggle = () => document.querySelector('input[type="checkbox"]') as HTMLInputElement;
  try {
    await render(state);
    assert.equal(buzz(), null);
    await act(async () => toggle().click());
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /Open a clue/);
    const active = { ...state, activeQuestionId: 'q1' };
    await render(active);
    assert.equal(buzz().disabled, false);
    assert.equal(buzz().textContent, 'Test early buzz');
    await act(async () => buzz().click());
    assert.deepEqual(emitted.at(-1), { event: E.HOST_BUZZ_PLAYER, payload: { roomCode: 'ROOM', playerId: player.id } });
    assert.match(document.body.textContent!, /Too early/);
    const open = { ...active, buzzerState: 'open' } as GameState;
    await render({ ...open, buzzLockouts: { [player.id]: now + 250 } });
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /Early-buzz penalty active/);
    now += 300;
    await act(async () => refresh());
    assert.equal(buzz().disabled, false);
    response = { ok: false, error: 'Not authorized as host for this room' };
    await act(async () => buzz().click());
    assert.match(document.body.textContent!, /Not authorized/);
    await render({ ...open, buzzLockouts: { [player.id]: PERMANENT_LOCKOUT } });
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /Locked out for this clue/);
    await render({ ...open, buzzerState: 'locked', buzzWindow: { deadline: now + 500, serverNow: now } });
    assert.equal(buzz().disabled, false); // Another player's late buzz can still be collected.
    now += 501;
    await act(async () => refresh());
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /Buzz window closed/);
    await render({ ...open, dailyDouble: { stage: 'picking' } } as GameState);
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /off during Daily Doubles/);
    await render({ ...open, finalJeopardy: { stage: 'intro' } } as GameState);
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /off during Final Jeopardy/);
    await render({ ...open, mode: 'teams' });
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /Assign this player to a team/);
    await render({ ...open, phase: 'finished' });
    assert.equal(buzz().disabled, true);
    assert.match(document.body.textContent!, /Game finished/);
    await act(async () => toggle().click());
    assert.equal(buzz(), null);
    assert.equal(cleared, true);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete (globalThis as any).__hostBuzzSocket;
    await rm(tempDir, { recursive: true, force: true });
  }
});
