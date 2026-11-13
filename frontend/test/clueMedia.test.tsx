import React, { act } from 'react';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import ClueMedia from '../src/components/shared/ClueMedia';

for (const mediaType of ['audio', 'video', 'youtube'] as const) {
  test(`${mediaType} clue starts, pauses on buzz, and resumes without replacing its player`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const old = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    let plays = 0;
    let pauses = 0;
    dom.window.HTMLMediaElement.prototype.play = async () => { plays++; };
    dom.window.HTMLMediaElement.prototype.pause = () => { pauses++; };
    const root = createRoot(document.getElementById('root')!);
    const mediaUrl = mediaType === 'youtube' ? 'https://youtu.be/dQw4w9WgXcQ' : `/clue.${mediaType}`;
    const render = (paused: boolean) => act(async () => root.render(
      <ClueMedia mediaType={mediaType} mediaUrl={mediaUrl} paused={paused} hideVideo={paused} />,
    ));
    try {
      await render(false);
      const player = document.querySelector<HTMLMediaElement | HTMLIFrameElement>('audio,video,iframe')!;
      const commands: string[] = [];
      if (mediaType === 'youtube') {
        const iframe = player as HTMLIFrameElement;
        assert.match(iframe.src, /autoplay=1/);
        assert.match(iframe.src, /enablejsapi=1/);
        iframe.contentWindow!.postMessage = (message: string) => { commands.push(JSON.parse(message).func); };
      } else {
        assert.equal(plays, 1);
        assert.equal((player as HTMLMediaElement).autoplay, true);
        (player as HTMLMediaElement).currentTime = 12;
      }
      await render(true);
      assert.equal(document.querySelector('audio,video,iframe'), player);
      if (mediaType === 'youtube') {
        assert.equal(commands.at(-1), 'pauseVideo');
        assert.equal(player.parentElement!.style.visibility, 'hidden');
        // A late player-ready event must respect the buzz that already arrived.
        window.dispatchEvent(new dom.window.MessageEvent('message', {
          origin: 'https://www.youtube.com', source: (player as HTMLIFrameElement).contentWindow,
          data: JSON.stringify({ event: 'onReady' }),
        }));
        assert.equal(commands.at(-1), 'pauseVideo');
      } else {
        assert.equal(pauses, 1);
        assert.equal((player as HTMLMediaElement).currentTime, 12);
        if (mediaType === 'video') assert.equal(player.style.visibility, 'hidden');
      }
      await render(false);
      assert.equal(document.querySelector('audio,video,iframe'), player);
      if (mediaType === 'youtube') {
        assert.equal(commands.at(-1), 'playVideo');
        assert.equal(player.parentElement!.style.visibility, 'visible');
      } else {
        assert.equal(plays, 2);
        assert.equal((player as HTMLMediaElement).currentTime, 12);
        if (mediaType === 'video') assert.equal(player.style.visibility, 'visible');
      }
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, old);
    }
  });
}

for (const mediaType of ['audio', 'video', 'youtube'] as const) {
  test(`remote ${mediaType} controls target the board player and respect answer pauses`, async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost' });
    const old = { window: globalThis.window, document: globalThis.document };
    Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
    let plays = 0;
    let pauses = 0;
    dom.window.HTMLMediaElement.prototype.play = async () => { plays++; };
    dom.window.HTMLMediaElement.prototype.pause = () => { pauses++; };
    const root = createRoot(document.getElementById('root')!);
    const render = (paused = false) => act(async () => root.render(<ClueMedia controlId="q:clue" mediaType={mediaType}
      mediaUrl={mediaType === 'youtube' ? 'https://youtu.be/dQw4w9WgXcQ' : '/media'} paused={paused} hideVideo={paused} />));
    const commands: Array<{ func: string; args: unknown[] }> = [];
    async function send(action: string, value?: number, mediaId = 'q:clue') {
      await act(async () => window.dispatchEvent(new dom.window.CustomEvent('board-media-command', { detail: { mediaId, action, value } })));
    }
    try {
      await render();
      const media = document.querySelector<HTMLMediaElement>('audio,video');
      const frame = document.querySelector('iframe');
      if (frame) frame.contentWindow!.postMessage = (message: string) => { commands.push(JSON.parse(message)); };
      const statuses: Array<{ mediaId: string; playing: boolean }> = [];
      window.addEventListener('board-media-status', event => statuses.push((event as CustomEvent).detail));
      if (media) {
        Object.defineProperty(media, 'paused', { value: false, configurable: true });
        media.dispatchEvent(new dom.window.Event('playing'));
      } else {
        window.dispatchEvent(new dom.window.MessageEvent('message', {
          origin: 'https://www.youtube.com', source: frame!.contentWindow,
          data: JSON.stringify({ event: 'infoDelivery', info: { playerState: 1 } }),
        }));
      }
      assert.equal(statuses.at(-1)?.mediaId, 'q:clue');
      assert.equal(statuses.at(-1)?.playing, true);
      if (media) {
        Object.defineProperty(media, 'paused', { value: true, configurable: true });
        media.dispatchEvent(new dom.window.Event('ended'));
      } else {
        window.dispatchEvent(new dom.window.MessageEvent('message', {
          origin: 'https://www.youtube.com', source: frame!.contentWindow,
          data: JSON.stringify({ event: 'onStateChange', info: 0 }),
        }));
      }
      assert.equal(statuses.at(-1)?.mediaId, 'q:clue');
      assert.equal(statuses.at(-1)?.playing, false);
      await send('status');
      assert.equal(statuses.at(-1)?.mediaId, 'q:clue');
      assert.equal(statuses.at(-1)?.playing, false);
      const initialPlays = plays;
      await send('pause', undefined, 'other:clue');
      assert.equal(pauses, 0);
      assert.equal(commands.length, 0);
      await send('pause');
      assert.ok(media ? pauses > 0 : commands.at(-1)?.func === 'pauseVideo');
      // A buzz and reopen must not override the host's manual pause.
      await render(true);
      await render(false);
      assert.equal(plays, initialPlays);
      await send('play');
      assert.ok(media ? plays > initialPlays : commands.at(-1)?.func === 'playVideo');
      if (media) {
        media.currentTime = 12;
        Object.defineProperty(media, 'duration', { value: 25 });
      } else {
        window.dispatchEvent(new dom.window.MessageEvent('message', {
          origin: 'https://www.youtube.com', source: frame!.contentWindow,
          data: JSON.stringify({ event: 'infoDelivery', info: { currentTime: 12, duration: 25 } }),
        }));
      }
      await send('seekTo', 12);
      assert.ok(media ? media.currentTime === 12 : commands.at(-1)?.args[0] === 12);
      await send('seek', -10);
      assert.ok(media ? media.currentTime === 2 : commands.at(-1)?.func === 'seekTo' && commands.at(-1)?.args[0] === 2);
      await send('seek', -10);
      assert.ok(media ? media.currentTime === 0 : commands.at(-1)?.args[0] === 0);
      await send('seek', 10);
      assert.ok(media ? media.currentTime === 10 : commands.at(-1)?.args[0] === 10);
      await send('seek', 60);
      assert.ok(media ? media.currentTime === 25 : commands.at(-1)?.args[0] === 25);
      await render(true);
      const beforePlay = plays;
      const beforeCommands = commands.length;
      await send('play');
      assert.equal(plays, beforePlay);
      assert.equal(commands.length, beforeCommands);
      await act(async () => root.unmount());
      const beforeUnmountCommand = commands.length;
      await send('play');
      assert.equal(commands.length, beforeUnmountCommand);
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, old);
    }
  });
}
