import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import BoardMediaPreview from '../src/components/host/BoardMediaPreview';
import type { MediaPlaybackStatus } from '../../backend/src/shared/mediaControls';

for (const type of ['audio', 'video', 'youtube']) {
  test(`${type} admin monitor follows board position, pauses and late player readiness without publishing events`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const old = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    let plays = 0;
    let pauses = 0;
    dom.window.HTMLMediaElement.prototype.play = async function () {
      plays++;
      Object.defineProperty(this, 'paused', { value: false, configurable: true });
    };
    dom.window.HTMLMediaElement.prototype.pause = function () {
      pauses++;
      Object.defineProperty(this, 'paused', { value: true, configurable: true });
    };
    let reports = 0;
    window.addEventListener('board-media-status', () => reports++);
    window.addEventListener('board-media-command', () => reports++);
    const root = createRoot(document.getElementById('root')!);
    const render = (status: MediaPlaybackStatus | null) => act(async () => root.render(<BoardMediaPreview type={type}
      url={type === 'youtube' ? 'https://youtu.be/dQw4w9WgXcQ' : '/media'} status={status} />));
    const state = { mediaId: 'q:clue', playing: true, currentTime: 30, duration: 120, playbackRate: 1.5 };
    const commands: Array<{ func: string; args: unknown[] }> = [];
    try {
      await render(null);
      assert.equal(plays, 0);
      const frame = document.querySelector('iframe');
      const media = document.querySelector<HTMLMediaElement>('audio,video');
      if (frame) {
        assert.match(frame.src, /autoplay=0/);
        assert.match(frame.src, /mute=1/);
        frame.contentWindow!.postMessage = (message: string) => commands.push(JSON.parse(message));
      }
      await render(state);
      if (frame) {
        assert.equal(commands.length, 0);
        window.dispatchEvent(new dom.window.MessageEvent('message', {
          origin: 'https://www.youtube.com', source: frame.contentWindow,
          data: JSON.stringify({ event: 'onReady' }),
        }));
        assert.ok(commands.some(c => c.func === 'mute'));
        assert.ok(commands.some(c => c.func === 'seekTo' && c.args[0] === 30));
        assert.equal(commands.at(-1)?.func, 'playVideo');
      } else {
        assert.equal(media!.muted, true);
        assert.equal(media!.controls, false);
        assert.equal(media!.currentTime, 30);
        assert.equal(media!.playbackRate, 1.5);
        assert.equal(plays, 1);
      }
      await render({ ...state, playing: false, currentTime: 42 });
      if (frame) {
        assert.ok(commands.some(c => c.func === 'seekTo' && c.args[0] === 42));
        assert.equal(commands.at(-1)?.func, 'pauseVideo');
      } else {
        assert.equal(media!.currentTime, 42);
        assert.equal(pauses, 1);
        // Metadata arriving late must apply the most recent board position.
        media!.currentTime = 0;
        media!.dispatchEvent(new dom.window.Event('loadedmetadata'));
        assert.equal(media!.currentTime, 42);
      }
      await render({ ...state, currentTime: 75 });
      assert.equal(document.querySelector('audio,video,iframe'), media ?? frame);
      assert.equal(reports, 0);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, old);
    }
  });
}
