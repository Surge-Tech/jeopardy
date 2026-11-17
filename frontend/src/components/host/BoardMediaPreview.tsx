import { useEffect, useRef } from 'react';
import type { MediaPlaybackStatus } from '@shared/mediaControls';
import { getYouTubeEmbedUrl } from '../../utils/media';

// Only the board publishes playback state. The muted admin player follows it and
// never reports its own events, avoiding command loops.
export default function BoardMediaPreview({ type, url, status }: {
  type: string; url: string; status: MediaPlaybackStatus | null;
}) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const latest = useRef(status);
  latest.current = status;
  const youtubeReady = useRef(false);
  const youtubeTime = useRef(0);

  function sync() {
    const state = latest.current;
    if (!state) return;
    const media = mediaRef.current;
    if (media) {
      if (state.currentTime !== undefined && Math.abs(media.currentTime - state.currentTime) > 0.5) {
        media.currentTime = state.currentTime;
      }
      if (state.playbackRate && media.playbackRate !== state.playbackRate) media.playbackRate = state.playbackRate;
      if (state.playing && media.paused) void media.play().catch(() => {});
      else if (!state.playing && !media.paused) media.pause();
    }
    if (type === 'youtube' && youtubeReady.current) {
      const send = (func: string, args: unknown[] = []) => frameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');
      send('mute');
      if (state.currentTime !== undefined && Math.abs(youtubeTime.current - state.currentTime) > 0.5) {
        send('seekTo', [state.currentTime, true]);
        youtubeTime.current = state.currentTime;
      }
      if (state.playbackRate) send('setPlaybackRate', [state.playbackRate]);
      send(state.playing ? 'playVideo' : 'pauseVideo');
    }
  }

  useEffect(sync, [status]);
  useEffect(() => {
    if (type !== 'youtube') return;
    youtubeReady.current = false;
    function message(event: MessageEvent) {
      if (event.origin !== 'https://www.youtube.com' || event.source !== frameRef.current?.contentWindow) return;
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (typeof data.info?.currentTime === 'number') youtubeTime.current = data.info.currentTime;
        if (['onReady', 'initialDelivery'].includes(data.event)) {
          youtubeReady.current = true;
          window.clearInterval(timer);
          sync();
        }
      } catch { /* Ignore unrelated messages. */ }
    }
    const timer = window.setInterval(() => frameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening' }), 'https://www.youtube.com'), 250);
    window.addEventListener('message', message);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('message', message);
    };
  }, [type, url]);

  if (type === 'video') return <video ref={element => { mediaRef.current = element; }} src={url} muted playsInline
    onLoadedMetadata={sync} aria-label="Board video preview" className="mb-3 max-h-64 w-full rounded-lg bg-black object-contain" />;
  if (type === 'audio') return <audio ref={element => { mediaRef.current = element; }} src={url} muted onLoadedMetadata={sync} aria-label="Board audio monitor" />;
  const src = new URL(getYouTubeEmbedUrl(url));
  src.searchParams.set('enablejsapi', '1');
  src.searchParams.set('autoplay', '0');
  src.searchParams.set('mute', '1');
  src.searchParams.set('controls', '0');
  src.searchParams.set('disablekb', '1');
  return <div className="mb-3 aspect-video w-full overflow-hidden rounded-lg bg-black">
    <iframe ref={frameRef} src={src.toString()} title="Board video preview" allow="autoplay" tabIndex={-1}
      className="pointer-events-none h-full w-full" />
  </div>;
}
