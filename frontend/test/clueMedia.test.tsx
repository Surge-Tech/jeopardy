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
        assert.equal(player.parentElement!.hidden, true);
        // A late player-ready event must respect the buzz that already arrived.
        window.dispatchEvent(new dom.window.MessageEvent('message', {
          origin: 'https://www.youtube.com', source: (player as HTMLIFrameElement).contentWindow,
          data: JSON.stringify({ event: 'onReady' }),
        }));
        assert.equal(commands.at(-1), 'pauseVideo');
      } else {
        assert.equal(pauses, 1);
        assert.equal((player as HTMLMediaElement).currentTime, 12);
        if (mediaType === 'video') assert.equal(player.hidden, true);
      }
      await render(false);
      assert.equal(document.querySelector('audio,video,iframe'), player);
      if (mediaType === 'youtube') {
        assert.equal(commands.at(-1), 'playVideo');
        assert.equal(player.parentElement!.hidden, false);
      } else {
        assert.equal(plays, 2);
        assert.equal((player as HTMLMediaElement).currentTime, 12);
        assert.equal(player.hidden, false);
      }
    } finally {
      await act(async () => root.unmount());
      dom.window.close();
      Object.assign(globalThis, old);
    }
  });
}
