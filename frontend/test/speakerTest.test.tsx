import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { SPEAKER_TEST_MEDIA_ID as mediaId } from '../../backend/src/shared/mediaControls';
import { SOCKET_EVENTS as E } from '../../backend/src/shared/socketEvents';

test('speaker test ships a nonempty MP3 recording', async () => {
  const recording = await readFile(new URL('../public/audio/speaker-test-da.mp3', import.meta.url));
  assert.ok(recording.length > 1024, 'the recording must be bundled, not just its transcript');
  assert.ok(recording.subarray(0, 3).toString() === 'ID3' || (recording[0] === 0xff && (recording[1] & 0xe0) === 0xe0), 'recording must contain MP3 data');
});

test('speaker test plays only on the board, supports replay/stop and reports playback errors to the host', async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const tempDir = await mkdtemp(join(testDir, '.speaker-test-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
  const old = { window: globalThis.window, document: globalThis.document };
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let plays = 0;
  let pauses = 0;
  let blocked = false;
  dom.window.HTMLMediaElement.prototype.play = async function () {
    plays++;
    if (blocked) throw new dom.window.DOMException('Blocked', 'NotAllowedError');
    Object.defineProperty(this, 'paused', { value: false, configurable: true });
    this.dispatchEvent(new dom.window.Event('playing'));
  };
  dom.window.HTMLMediaElement.prototype.pause = function () {
    pauses++;
    Object.defineProperty(this, 'paused', { value: true, configurable: true });
  };
  const sent: any[] = [];
  const listeners = new Map<string, Function>();
  (globalThis as any).__speakerSocket = {
    on: (event: string, fn: Function) => listeners.set(event, fn),
    off: (event: string) => listeners.delete(event),
    emit: (event: string, payload: unknown) => {
      sent.push({ event, payload });
      if (event === E.HOST_MEDIA_COMMAND) window.dispatchEvent(new dom.window.CustomEvent('board-media-command', { detail: payload }));
    },
  };
  window.addEventListener('board-media-status', event => listeners.get(E.BOARD_MEDIA_STATUS)?.((event as CustomEvent).detail));
  const root = createRoot(document.getElementById('root')!);
  try {
    await build({
      entryPoints: [join(testDir, '../src/components/shared/LobbySpeakerTest.tsx')], outfile: join(tempDir, 'speaker.mjs'),
      bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', tsconfig: join(testDir, '../tsconfig.json'),
      plugins: [{ name: 'test-socket', setup(builder) {
        builder.onResolve({ filter: /\/socket$/ }, () => ({ path: 'socket', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const socket = globalThis.__speakerSocket;', loader: 'js' }));
      } }],
    });
    const { default: SpeakerTest } = await import(pathToFileURL(join(tempDir, 'speaker.mjs')).href);
    const render = (board = true, host = true) => act(async () => root.render(<>
      {board && <div id="board"><SpeakerTest /></div>}
      {host && <div id="host"><SpeakerTest roomCode="ROOM" /></div>}
    </>));
    const click = (screen: string, label: string) => act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>(`#${screen} button`)].find(b => b.textContent === label)!.click();
    });
    const command = (action: string, id = mediaId) => act(async () => {
      window.dispatchEvent(new dom.window.CustomEvent('board-media-command', { detail: { mediaId: id, action } }));
    });
    await render();
    assert.equal(plays, 0, 'does not autoplay when entering the lobby');
    assert.equal(document.querySelectorAll('audio').length, 1);
    assert.equal(document.querySelector('#host audio'), null, 'host never plays sound');
    assert.equal(document.querySelector('#board button'), null, 'board has no speaker test controls');
    const audio = document.querySelector('audio')!;
    assert.equal(audio.hidden, true);
    assert.equal(audio.getAttribute('src'), '/audio/speaker-test-da.mp3');
    assert.equal(audio.volume, 1, 'matches the default clue recording volume');
    await command('play', 'q:recording');
    assert.equal(plays, 0, 'ignores unrelated clue commands');
    await click('host', 'Test speakers');
    assert.equal(plays, 1);
    assert.deepEqual(sent.at(-1), { event: E.HOST_MEDIA_COMMAND, payload: { roomCode: 'ROOM', mediaId, action: 'play' } });
    assert.equal(document.querySelector('#host p'), null);
    assert.equal(document.querySelectorAll('#host button').length, 1);
    audio.currentTime = 5;
    await click('host', 'Replay speaker test');
    assert.equal(plays, 2);
    assert.equal(audio.currentTime, 0);
    audio.currentTime = 4;
    await command('pause');
    assert.equal(audio.paused, true);
    assert.equal(audio.currentTime, 0);
    blocked = true;
    await click('host', 'Test speakers');
    assert.match(document.querySelector('#host button')!.getAttribute('title')!, /Click anywhere on the board view/);
    blocked = false;
    await click('host', 'Test speakers');
    assert.equal(document.querySelector('#host button')!.getAttribute('title'), null);
    await act(async () => {
      Object.defineProperty(audio, 'ended', { value: true, configurable: true });
      audio.dispatchEvent(new dom.window.Event('ended'));
    });
    assert.equal(document.querySelector('#host button')!.textContent, 'Test speakers');
    const previousPauses = pauses;
    await render(false, false);
    assert.ok(pauses > previousPauses, 'leaving the lobby stops playback');
    const previousPlays = plays;
    await command('play');
    assert.equal(plays, previousPlays, 'unmount removes the command listener');
    assert.equal(listeners.size, 0);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    Object.assign(globalThis, old);
    delete (globalThis as any).__speakerSocket;
    await rm(tempDir, { recursive: true, force: true });
  }
});
