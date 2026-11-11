import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';
import * as gm from '../../backend/src/socket/gameManager';

test('host remembers its room across remounts, reconnects, and clears it when closed', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.host-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const originalFetch = globalThis.fetch;
  Object.assign(globalThis, {
    window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true,
    confirm: () => true,
  });
  const { createRoot } = await import('react-dom/client');
  const { MemoryRouter, Route, Routes } = await import('react-router-dom');
  const handlers = new Map<string, (...args: any[]) => void>();
  const emitted: Array<{ event: string; payload: any }> = [];
  const socket = {
    connected: false,
    on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
    off: (event: string) => handlers.delete(event),
    emit: (event: string, payload: unknown) => emitted.push({ event, payload }),
  };
  (globalThis as any).__hostSocket = socket;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 'board', name: 'Test board', rounds: [{ id: 'round', pointValues: [200], categories: [] }],
  }));
  let root = createRoot(document.getElementById('root')!);
  const state = gm.createSession('board');
  try {
    await build({
      entryPoints: [join(testDir, '../src/pages/Host.tsx')],
      outfile: join(tempDir, 'Host.mjs'), bundle: true, platform: 'node',
      format: 'esm', packages: 'external', jsx: 'automatic',
      tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'test-socket', setup(builder) {
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({
          contents: 'export const socket = globalThis.__hostSocket;', loader: 'js',
        }));
      } }],
    });
    const { default: Host } = await import(pathToFileURL(join(tempDir, 'Host.mjs')).href);
    async function mount() {
      await act(async () => root.render(
        <React.StrictMode><MemoryRouter initialEntries={['/host/board']}>
          <Routes><Route path="/host/:boardId" element={<Host />} /><Route path="/" element={<div>Home</div>} /></Routes>
        </MemoryRouter></React.StrictMode>,
      ));
    }
    await mount();
    assert.equal(emitted.length, 0, 'wait for connection instead of buffering duplicate creation requests');
    socket.connected = true;
    await act(async () => handlers.get('connect')!());
    assert.deepEqual(emitted.at(-1), { event: E.HOST_CREATE, payload: { boardId: 'board', roomCode: undefined } });
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: state.roomCode, state, resumed: false }));
    assert.equal(window.sessionStorage.getItem('jeopardy:host-room:board'), state.roomCode);

    await act(async () => root.unmount());
    root = createRoot(document.getElementById('root')!);
    await mount();
    assert.deepEqual(emitted.at(-1), { event: E.HOST_CREATE, payload: { boardId: 'board', roomCode: state.roomCode } });
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: state.roomCode, state, resumed: true }));
    await act(async () => handlers.get('connect')!());
    assert.equal(emitted.at(-1)!.payload.roomCode, state.roomCode);

    // A replacement room after server restart becomes the next resume target.
    const replacement = { ...state, roomCode: 'NEW12' };
    await act(async () => handlers.get(E.HOST_CREATED)!({ roomCode: replacement.roomCode, state: replacement, resumed: false }));
    await act(async () => handlers.get('connect')!());
    assert.equal(emitted.at(-1)!.payload.roomCode, 'NEW12');
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Close Room')!.click());
    assert.equal(window.sessionStorage.getItem('jeopardy:host-room:board'), null);
    assert.deepEqual(emitted.at(-1), { event: E.HOST_END, payload: { roomCode: 'NEW12' } });
  } finally {
    await act(async () => root.unmount());
    gm.deleteSession(state.roomCode);
    globalThis.fetch = originalFetch;
    delete (globalThis as any).__hostSocket;
    dom.window.close();
    await rm(tempDir, { recursive: true, force: true });
  }
});
