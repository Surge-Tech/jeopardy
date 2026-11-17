import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { Resvg } from '@resvg/resvg-js';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import * as gm from '../../backend/src/socket/gameManager';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('board lobby, host readiness and phones follow the explicit start transition and reconnect state', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.lobby-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://192.168.1.5:5173' });
  const originalFetch = globalThis.fetch;
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  Object.assign(globalThis, { window: dom.window, document: dom.window.document,
    localStorage: dom.window.localStorage, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
  });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const state = gm.createSession('board');
  const room = state.roomCode;
  const board = { id: 'board', name: 'Lobby test', rounds: [{ id: 'round', pointValues: [200], categories: [{ id: 'cat', name: 'Test category', questions: [{ id: 'clue', value: 200, clue: 'Clue', response: 'Answer' }] }] }], finalJeopardy: { category: 'Final', clue: 'Clue', response: 'Answer' } };
  globalThis.fetch = async () => new Response(JSON.stringify(board));
  const handlers = new Map<string, (...args: any[]) => void>();
  const emitted: string[] = [];
  const socket = {
    connected: false,
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (event: string, payload?: any, ack?: (res: any) => void) => {
      emitted.push(event);
      if (event === E.HOST_LOBBY_BUZZER) {
        const ok = gm.setLobbyBuzzer(room, payload.action);
        ack?.({ ok });
        handlers.get(E.GAME_STATE)?.(structuredClone(state));
      }
    },
    timeout: () => ({ emit: (event: string, _payload: unknown, ack: (...args: any[]) => void) => {
      emitted.push(event);
      assert.equal(gm.startGame(room), true);
      ack(null, { ok: true });
      handlers.get(E.GAME_STATE)?.(structuredClone(state));
    } }),
  };
  (globalThis as any).__lobbySocket = socket;
  const root = createRoot(document.getElementById('root')!);
  try {
    await build({
      stdin: { contents: `export { default as BoardView } from './pages/BoardView'; export { default as Host } from './pages/Host'; export { default as Buzzer } from './pages/Buzzer';`, resolveDir: join(testDir, '../src'), loader: 'tsx' },
      outfile: join(tempDir, 'lobby.mjs'), bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'socket', setup(builder) {
        builder.onResolve({ filter: /\/utils\/sounds$/ }, () => ({ path: 'sounds', namespace: 'test-sounds' }));
        builder.onLoad({ filter: /.*/, namespace: 'test-sounds' }, () => ({
          contents: ['enableSounds', 'playDailyDouble', 'playBuzzerReady', 'playBuzzIn', 'playWrong', 'playFinalJeopardy', 'playTick', 'playTimesUp', 'playReveal', 'playWinnerFanfare', 'playThinkingPulse', 'stopThinkingPulse']
            .map(name => `export function ${name}() {}`).join('\n'), loader: 'js',
        }));
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__lobbySocket;', loader: 'js' }));
      } }],
    });
    const { BoardView, Host, Buzzer } = await import(pathToFileURL(join(tempDir, 'lobby.mjs')).href);
    async function mount(path: string, pattern: string, element: React.ReactNode) {
      await act(async () => root.render(null));
      await act(async () => root.render(<MemoryRouter initialEntries={[path]}><Routes><Route path={pattern} element={element} /></Routes></MemoryRouter>));
    }
    async function broadcast() { await act(async () => handlers.get(E.GAME_STATE)!(structuredClone(state))); }
    await mount(`/board/${room}`, '/board/:roomCode', <BoardView />);
    await broadcast();
    assert.match(document.body.textContent!, /Scan to join—players will appear here/);
    assert.doesNotMatch(document.body.textContent!, /Test category/);
    assert.match(document.body.textContent!, /Team mode/);
    gm.setMode(room, 'individual');
    const svg = document.querySelector('svg')!;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const png = PNG.sync.read(new Resvg(svg.outerHTML).render().asPng());
    assert.equal(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data, `http://192.168.1.5:5173/buzz/${room}`);
    const alice = gm.addPlayer(room, 'Alice', '#ffffff')!;
    await broadcast();
    assert.match(document.body.textContent!, /1 player joined/);
    assert.match(document.body.textContent!, /Individual mode/);
    gm.setMode(room, 'teams');
    gm.saveTeam(room, undefined, 'Blue', '#0000ff');
    gm.assignTeam(room, alice.id, state.teams[0].id);
    const bob = gm.addPlayer(room, 'Bob', '#ffffff')!;
    await broadcast();
    assert.match(document.body.textContent!, /Team mode/);
    assert.match(document.body.textContent!, /Blue.*Alice.*Captain/);
    assert.match(document.body.textContent!, /Awaiting team assignment.*Bob/);
    gm.setLobbyBuzzer(room, 'open');
    await broadcast();
    assert.ok(document.querySelector('.board-buzzer-dock--lobby .buzzer-status--display.buzzer-status--open'));
    gm.recordBuzz(room, bob.id, bob.name, Date.now());
    await broadcast();
    assert.match(document.querySelector('.board-buzzer-dock--lobby .buzzer-status--display')!.textContent!, /Buzzed in.*Bob/);
    assert.equal(document.querySelector('.board-buzz-order'), null);
    gm.finishBuzzCollection(room, state.buzzWindow);
    await broadcast();
    assert.match(document.querySelector('.board-buzzer-dock--lobby .board-buzz-order')!.textContent!, /Bob.*First/);
    assert.ok(document.querySelector('[aria-label="Join game"]'), 'practice keeps the join QR visible');
    gm.setLobbyBuzzer(room, 'reset');
    await broadcast();
    assert.equal(document.querySelector('.board-buzzer-dock--lobby'), null);
    // A reconnect gets the same lobby and roster.
    await act(async () => handlers.get('connect')!());
    assert.equal(emitted.at(-1), E.HOST_JOIN);
    await mount('/host/board', '/host/:boardId', <Host />);
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: room, state: structuredClone(state) }));
    const control = (text: string) => [...document.querySelectorAll('button')].find(button => button.textContent === text)!;
    await act(async () => control('Open buzzers').click());
    assert.equal(state.phase, 'lobby');
    assert.equal(control('Open buzzers').disabled, true);
    const practiceOpen = structuredClone(state);
    gm.recordBuzz(room, alice.id, alice.name, Date.now());
    await broadcast();
    const practiceWinner = structuredClone(state);
    assert.match(document.querySelector('[aria-label="Lobby buzzer test"]')!.textContent!, /Alice.*First/);
    await act(async () => control('Reset test').click());
    assert.equal(state.buzzerState, 'idle');
    assert.equal(document.querySelector('[aria-label="Buzz order"]'), null);
    const start = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Start game')!;
    assert.equal(start().disabled, true);
    assert.match(document.body.textContent!, /Assign every player/);
    assert.doesNotMatch(document.body.textContent!, /Test category|Start Final Jeopardy|Next Round|Select a card/);
    gm.assignTeam(room, bob.id, state.teams[0].id);
    const lobby = structuredClone(state);
    await broadcast();
    assert.equal(start().disabled, false);
    await act(async () => start().click());
    assert.equal(emitted.at(-1), E.HOST_START);
    assert.match(document.body.textContent!, /Test category/);
    assert.equal(document.querySelector('[aria-label="Lobby setup"]'), null);
    await mount(`/board/${room}`, '/board/:roomCode', <BoardView />);
    await broadcast();
    assert.match(document.body.textContent!, /Test category/);
    assert.equal(document.querySelector('[aria-label="Join game"]'), null);
    await act(async () => handlers.get(E.GAME_STATE)!(lobby));
    assert.match(document.body.textContent!, /Sound is not enabled/);
    await act(async () => window.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    assert.doesNotMatch(document.body.textContent!, /Sound is not enabled/);
    await broadcast();
    assert.doesNotMatch(document.body.textContent!, /Sound is not enabled/, 'enabled sound stays enabled when the lobby becomes the game board');
    await broadcast();
    await act(async () => handlers.get('connect')!());
    await broadcast();
    gm.openQuestion(room, 'clue', false);
    await broadcast();
    await mount(`/buzz/${room}`, '/buzz/:roomCode', <Buzzer />);
    await act(async () => handlers.get(E.PLAYER_JOINED)!({ player: alice, state: lobby }));
    assert.match(document.body.textContent!, /Waiting for the host to start the game/);
    assert.equal(document.querySelector<HTMLButtonElement>('.player-buzz-button')!.disabled, true);
    await act(async () => handlers.get(E.GAME_STATE)!(practiceOpen));
    assert.equal(document.querySelector<HTMLButtonElement>('.player-buzz-button')!.disabled, false);
    await act(async () => document.querySelector<HTMLButtonElement>('.player-buzz-button')!.click());
    assert.equal(emitted.at(-1), E.BUZZ);
    await act(async () => handlers.get(E.GAME_STATE)!(practiceWinner));
    assert.match(document.body.textContent!, /First buzz!/);
    assert.doesNotMatch(document.body.textContent!, /Your turn to answer/);
    assert.equal(document.querySelector<HTMLButtonElement>('.player-buzz-button')!.disabled, true);
    await act(async () => handlers.get(E.PLAYER_JOINED)!({ player: alice, state: practiceWinner }));
    assert.match(document.body.textContent!, /First buzz!/);
    await act(async () => handlers.get(E.GAME_STATE)!(lobby));
    assert.equal(document.querySelector('[aria-label="Buzz order"]'), null);
    await broadcast();
    assert.doesNotMatch(document.body.textContent!, /Waiting for the host to start the game/);
    gm.openQuestion(room, 'clue', false);
    gm.revealClue(room, 'image');
    await broadcast();
    assert.equal(document.querySelector<HTMLButtonElement>('.player-buzz-button')!.disabled, false);
    assert.match(document.body.textContent!, /BUZZ!/);
    // Rejoining during play restores the current buzzer state.
    await act(async () => handlers.get(E.PLAYER_JOINED)!({ player: alice, state: structuredClone(state) }));
    assert.equal(document.querySelector<HTMLButtonElement>('.player-buzz-button')!.disabled, false);
  } finally {
    await act(async () => root.unmount());
    gm.deleteSession(room);
    globalThis.fetch = originalFetch;
    dom.window.close();
    await rm(tempDir, { recursive: true, force: true });
    delete (globalThis as any).__lobbySocket;
  }
});
