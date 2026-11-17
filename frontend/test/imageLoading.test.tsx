import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ClueMedia from '../src/components/shared/ClueMedia';
import ResponseMedia from '../src/components/shared/ResponseMedia';
import { useBoardImagePreload } from '../src/hooks/useBoardImagePreload';
import type { Board } from '../../backend/src/shared/types';

test('clue and answer images hide alt text while loading, reveal on load, and handle failed replacements', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  try {
    for (const kind of ['clue', 'answer']) {
      const render = (url: string) => act(async () => root.render(kind === 'clue'
        ? <ClueMedia mediaType="image" mediaUrl={url} paused={false} hideVideo={false} />
        : <ResponseMedia responseMediaType="image" responseMediaUrl={url} />));
      await render(`/${kind}.png`);
      const image = document.querySelector('img')!;
      assert.equal(image.style.visibility, 'hidden');
      assert.equal(document.querySelector('[role=status]')?.textContent, 'Loading image…');
      await act(async () => image.dispatchEvent(new dom.window.Event('load')));
      assert.equal(image.style.visibility, 'visible');
      assert.equal(document.querySelector('[role=status]'), null);
      await render('/replacement.png');
      const replacement = document.querySelector('img')!;
      assert.equal(replacement.style.visibility, 'hidden');
      await act(async () => replacement.dispatchEvent(new dom.window.Event('error')));
      assert.equal(document.querySelector('[role=status]')?.textContent, 'Image could not be loaded');
      assert.equal(document.querySelector('[aria-busy]')?.getAttribute('aria-busy'), 'false');
    }
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});

test('board preloading prioritizes the active question, limits requests, and skips video/audio', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const images: HTMLImageElement[] = [];
  dom.window.Image = function () {
    const image = dom.window.document.createElement('img');
    images.push(image);
    return image;
  } as unknown as typeof Image;
  const board = { rounds: [{ categories: [{ questions: [
    { id: 'other', mediaType: 'image', mediaUrl: '/other.png', responseMediaType: 'image', responseMediaUrl: '/other-answer.png' },
    { id: 'active', mediaType: 'image', mediaUrl: '/active.png', responseMediaType: 'image', responseMediaUrl: '/active-answer.png' },
    { id: 'video', mediaType: 'video', mediaUrl: '/large.mp4', responseMediaType: 'audio', responseMediaUrl: '/answer.mp3' },
    { id: 'duplicate', mediaType: 'image', mediaUrl: '/other.png' },
  ] }] }], finalJeopardy: { mediaType: 'image', mediaUrl: '/final.png' } } as Board;
  function Preload() { useBoardImagePreload(board, 0, 'active'); return null; }
  const root = createRoot(document.getElementById('root')!);
  try {
    await act(async () => root.render(<Preload />));
    assert.deepEqual(images.map(image => image.getAttribute('src')), ['/active.png', '/active-answer.png', '/other.png']);
    images[0].dispatchEvent(new dom.window.Event('load'));
    assert.equal(images[3].getAttribute('src'), '/other-answer.png');
    images[1].dispatchEvent(new dom.window.Event('error'));
    assert.equal(images[4].getAttribute('src'), '/final.png');
    images[2].dispatchEvent(new dom.window.Event('load'));
    assert.equal(images.length, 5);
    await act(async () => root.unmount());
    assert.equal(images[3].onload, null);
    assert.equal(images[4].onerror, null);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
