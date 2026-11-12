import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Editor from '../src/pages/Editor';

test('board deletion requires confirmation, preserves the editor on failure, and returns home on success', async t => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const board = {
    id: 'board-1', name: 'Game Night',
    rounds: [{ id: 'round-1', pointValues: [200], categories: [] }],
  };
  let confirmed = false;
  let succeeds = false;
  let deletes = 0;
  t.mock.method(dom.window, 'confirm', (message: string) => {
    assert.match(message, /Game Night/);
    assert.match(message, /cannot be undone/);
    return confirmed;
  });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, '/api/boards/board-1');
    if (options?.method === 'DELETE') {
      deletes++;
      return new Response(null, { status: succeeds ? 204 : 500 });
    }
    return new Response(JSON.stringify(board));
  });
  const root = createRoot(document.getElementById('root')!);
  const deleteButton = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Delete board')!;
  try {
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/editor/board-1']}>
        <Routes>
          <Route path="/editor/:boardId" element={<Editor />} />
          <Route path="/" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>
    ));
    await act(async () => deleteButton().click());
    assert.equal(deletes, 0);
    confirmed = true;
    await act(async () => deleteButton().click());
    assert.equal(deletes, 1);
    assert.match(document.querySelector('[role="alert"]')?.textContent ?? '', /Could not delete/);
    assert.equal(deleteButton().disabled, false);
    succeeds = true;
    await act(async () => deleteButton().click());
    assert.equal(deletes, 2);
    assert.equal(document.getElementById('root')?.textContent, 'Dashboard');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
