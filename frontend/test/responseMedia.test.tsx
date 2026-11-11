import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ResponseMedia from '../src/components/shared/ResponseMedia';
import FinalJeopardyEditor from '../src/components/final/FinalJeopardyEditor';
import FinalBoardScreen from '../src/components/final/FinalBoardScreen';
import Editor from '../src/pages/Editor';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { FinalJeopardyBoard, GameState } from '../../backend/src/shared/types';

test('answer images, videos and YouTube render with manual playback for host previews', () => {
  assert.equal(renderToStaticMarkup(<ResponseMedia />), '');
  const image = renderToStaticMarkup(<ResponseMedia responseMediaType="image" responseMediaUrl="/answer.png" />);
  assert.match(image, /<img/);
  const video = renderToStaticMarkup(<ResponseMedia responseMediaType="video" responseMediaUrl="/answer.mp4" />);
  assert.match(video, /controls/);
  assert.doesNotMatch(video, /autoPlay/i);
  assert.match(renderToStaticMarkup(<ResponseMedia responseMediaType="video" responseMediaUrl="/answer.mp4" autoPlay />), /autoPlay/i);
  const youtube = renderToStaticMarkup(<ResponseMedia responseMediaType="youtube" responseMediaUrl="https://youtu.be/dQw4w9WgXcQ" />);
  assert.match(youtube, /autoplay=0/);
});

test('Final Jeopardy screen hides answer media until the correct response stage', () => {
  const state = { players: [], finalJeopardy: { stage: 'wagering', contestants: [], category: 'Category', deadline: null, serverNow: Date.now(), response: '', responseMediaType: 'image', responseMediaUrl: '/secret-answer.png' } } as unknown as GameState;
  assert.doesNotMatch(renderToStaticMarkup(<FinalBoardScreen gameState={state} />), /secret-answer/);
  state.finalJeopardy!.stage = 'response';
  assert.match(renderToStaticMarkup(<FinalBoardScreen gameState={state} />), /secret-answer/);
});

test('answer upload, save and removal preserve separate clue media, and failures retain the answer', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  let saved: FinalJeopardyBoard | undefined;
  let failUpload = false;
  globalThis.fetch = async (_input, init) => {
    assert.equal(init?.method, 'POST');
    assert.ok(init?.body instanceof FormData);
    return new Response(JSON.stringify(failUpload ? { error: 'File type not allowed' } : { mediaType: 'video', url: '/media/answer.mp4' }), { status: failUpload ? 400 : 200 });
  };
  try {
    await act(async () => root.render(<FinalJeopardyEditor finalJeopardy={{ category: 'Final', clue: 'Clue', response: '', mediaType: 'image', mediaUrl: '/media/clue.png' }} onSave={value => { saved = value; }} onRemove={() => {}} onClose={() => {}} />));
    const upload = document.querySelectorAll<HTMLInputElement>('input[type=file]')[1];
    const file = new Blob(['test video'], { type: 'video/mp4' });
    Object.defineProperty(upload, 'files', { value: [file], configurable: true });
    await act(async () => upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.equal(document.querySelector('video')?.getAttribute('src'), '/media/answer.mp4');
    assert.equal(document.querySelector('img')?.getAttribute('src'), '/media/clue.png');
    const save = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save')!;
    await act(async () => save().click());
    assert.equal(saved?.responseMediaUrl, '/media/answer.mp4');
    assert.equal(saved?.responseMediaType, 'video');
    assert.equal(saved?.mediaUrl, '/media/clue.png');
    failUpload = true;
    await act(async () => upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.match(document.querySelector('[role=alert]')?.textContent ?? '', /File type not allowed/);
    assert.equal(document.querySelector('video')?.getAttribute('src'), '/media/answer.mp4');
    const answerSection = upload.closest('fieldset')!;
    await act(async () => [...answerSection.querySelectorAll('button')].find(b => b.textContent === 'Remove Media')!.click());
    await act(async () => save().click());
    assert.equal(saved?.responseMediaUrl, undefined);
    assert.equal(saved?.responseMediaType, undefined);
    assert.equal(saved?.mediaUrl, '/media/clue.png');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});

test('regular question editor saves answer media independently inside the rounds payload', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')!);
  const board = { id: 'board', name: 'Test', rounds: [{ id: 'round', pointValues: [200], categories: [{ id: 'category', name: 'Category', questions: [{ id: 'question', value: 200, clue: 'Clue', response: 'Answer', mediaType: 'image', mediaUrl: '/clue.png' }] }] }] };
  let written: typeof board | undefined;
  globalThis.fetch = async (input, init) => {
    if (input === '/api/media/upload') return new Response(JSON.stringify({ mediaType: 'image', url: '/answer.png' }));
    if (init?.method === 'PUT') written = JSON.parse(init.body as string);
    return new Response(JSON.stringify(board));
  };
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/edit/board']}><Routes><Route path="/edit/:boardId" element={<Editor />} /></Routes></MemoryRouter>));
    await act(async () => document.querySelector<HTMLButtonElement>('tbody button')!.click());
    const upload = document.querySelectorAll<HTMLInputElement>('input[type=file]')[1];
    Object.defineProperty(upload, 'files', { value: [new Blob(['image'], { type: 'image/png' })] });
    await act(async () => upload.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === 'Save')!.click());
    const question = written?.rounds[0].categories[0].questions[0];
    assert.equal(question?.mediaUrl, '/clue.png');
    assert.equal((question as unknown as { responseMediaUrl: string }).responseMediaUrl, '/answer.png');
    assert.equal(question?.id, 'question');
    assert.equal(question?.response, 'Answer');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
  }
});
