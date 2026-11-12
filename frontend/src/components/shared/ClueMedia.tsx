import { useEffect, useRef } from 'react';
import type { Question } from '@shared/types';
import { getYouTubeEmbedUrl } from '../../utils/media';

type Props = Pick<Question, 'mediaType' | 'mediaUrl'> & {
  paused: boolean;
  hideVideo: boolean;
};

// Keep players mounted during an answer so reopening the buzzers resumes
// the clue from where it paused rather than replaying it from the start.
export default function ClueMedia({ mediaType, mediaUrl, paused, hideVideo }: Props) {
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const youtubeRef = useRef<HTMLIFrameElement | null>(null);
  const initiallyPaused = useRef(paused);
  const youtubePaused = useRef(paused);
  youtubePaused.current = paused;

  function syncYouTube() {
    youtubeRef.current?.contentWindow?.postMessage(JSON.stringify({
      event: 'command', func: youtubePaused.current ? 'pauseVideo' : 'playVideo', args: [],
    }), 'https://www.youtube.com');
  }

  useEffect(() => {
    const media = mediaRef.current;
    let cancelled = false;
    if (media) {
      if (paused) media.pause();
      else {
        // Browsers may require a user gesture; keep controls available for it.
        void media.play().then(() => {
          if (cancelled && (youtubePaused.current || mediaRef.current !== media)) media.pause();
        }).catch(() => {});
      }
    }
    syncYouTube();
    return () => { cancelled = true; };
  }, [paused, mediaType, mediaUrl]);

  // YouTube commands can arrive before the embedded player is ready. Listen
  // for its ready message as well as sending the command when props change.
  useEffect(() => {
    if (mediaType !== 'youtube') return;
    // The frame can finish loading before its player accepts commands. Keep
    // requesting the ready handshake until the player responds.
    const readyTimer = window.setInterval(() => {
      youtubeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), 'https://www.youtube.com');
    }, 250);
    function onMessage(event: MessageEvent) {
      if (event.origin !== 'https://www.youtube.com' || event.source !== youtubeRef.current?.contentWindow) return;
      try {
        if (['onReady', 'initialDelivery'].includes(JSON.parse(event.data).event)) {
          window.clearInterval(readyTimer);
          syncYouTube();
        }
      } catch { /* Ignore unrelated player messages. */ }
    }
    window.addEventListener('message', onMessage);
    return () => {
      window.clearInterval(readyTimer);
      window.removeEventListener('message', onMessage);
    };
  }, [mediaType, mediaUrl]);

  if (!mediaUrl) return null;
  if (mediaType === 'image') {
    return <img src={mediaUrl} alt="clue" className="max-h-[60dvh] object-contain mb-6 rounded w-full" />;
  }
  if (mediaType === 'audio') {
    return <audio ref={element => { mediaRef.current = element; }} src={mediaUrl} autoPlay={!paused} controls aria-label="Clue audio" className="mb-6 w-full max-w-2xl" />;
  }
  if (mediaType === 'video') {
    return <video ref={element => { mediaRef.current = element; }} src={mediaUrl} autoPlay={!paused} playsInline controls hidden={hideVideo} aria-label="Clue video" className="max-h-[60dvh] object-contain mb-6 rounded w-full" />;
  }
  if (mediaType === 'youtube') {
    const src = new URL(getYouTubeEmbedUrl(mediaUrl));
    src.searchParams.set('enablejsapi', '1');
    src.searchParams.set('autoplay', initiallyPaused.current ? '0' : '1');
    return (
      <div hidden={hideVideo} className="mb-6 w-full aspect-video max-h-[60dvh]">
        <iframe ref={youtubeRef} title="Clue video" className="w-full h-full rounded"
          src={src.toString()} allow="autoplay; fullscreen" allowFullScreen
          onLoad={() => {
            youtubeRef.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening' }), 'https://www.youtube.com');
            syncYouTube();
          }} />
      </div>
    );
  }
  return null;
}
