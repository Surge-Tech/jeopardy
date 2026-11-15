import type { MediaCommand } from '@shared/mediaControls';
import { useEffect, useRef, useState } from 'react';
import type { Question } from '@shared/types';
import { getYouTubeEmbedUrl } from '../../utils/media';
import LoadingImage from './LoadingImage';

type Props = Pick<Question, 'mediaType' | 'mediaUrl'> & {
  controlId?: string;
  paused: boolean;
  hideVideo: boolean;
  onEnded?: () => void;
  onPlaybackProblem?: (message: string) => void;
  audioLabel?: string;
  hideAudioPlayer?: boolean;
  onPlaying?: () => void;
};

// Keep players mounted during an answer so reopening the buzzers resumes
// the clue from where it paused rather than replaying it from the start.
export default function ClueMedia({ mediaType, mediaUrl, paused: gamePaused, hideVideo, controlId, onEnded, onPlaybackProblem, audioLabel = 'Clue audio', hideAudioPlayer = true, onPlaying }: Props) {
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const paused = gamePaused || manuallyPaused;
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const youtubeRef = useRef<HTMLIFrameElement | null>(null);
  const youtubePlaying = useRef(false);
  const youtubeTime = useRef(0);
  const youtubeRate = useRef(1);
  const youtubeDuration = useRef<number | undefined>();
  const initiallyPaused = useRef(paused);
  const youtubePaused = useRef(paused);
  youtubePaused.current = paused;

  function reportPlayback() {
    if (!controlId) return;
    const media = mediaRef.current;
    window.dispatchEvent(new window.CustomEvent('board-media-status', { detail: {
      mediaId: controlId,
      playing: media ? !media.paused && !media.ended : youtubePlaying.current,
      currentTime: media ? media.currentTime : youtubeTime.current,
      duration: Number.isFinite(media ? media.duration : youtubeDuration.current) ? (media ? media.duration : youtubeDuration.current) : undefined,
      playbackRate: media ? media.playbackRate : youtubeRate.current,
    } }));
  }

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
        // Report blocked autoplay so the board can offer a playback fallback.
        void media.play().then(() => {
          if (cancelled && (youtubePaused.current || mediaRef.current !== media)) media.pause();
        }).catch(() => {
          if (!cancelled) onPlaybackProblem?.('Press play on the board to start the recording, or open buzzers manually from the host.');
        });
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
        const message = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        const playerState = message.event === 'onStateChange' ? message.info : message.info?.playerState;
        if (typeof playerState === 'number') {
          youtubePlaying.current = playerState === 1;
        }
        if (typeof message.info?.currentTime === 'number') youtubeTime.current = message.info.currentTime;
        if (typeof message.info?.duration === 'number') youtubeDuration.current = message.info.duration;
        if (typeof message.info?.playbackRate === 'number') youtubeRate.current = message.info.playbackRate;
        reportPlayback();
        if (['onReady', 'initialDelivery'].includes(message.event)) {
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
  }, [mediaType, mediaUrl, controlId]);

  useEffect(() => {
    if (!controlId) return;
    function command(event: Event) {
      const { mediaId, action, value } = (event as CustomEvent<MediaCommand>).detail;
      if (mediaId !== controlId) return;
      const media = mediaRef.current;
      const youtube = (func: string, args: unknown[] = []) => youtubeRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func, args }), 'https://www.youtube.com');
      if (action === 'status') {
        reportPlayback();
      } else if (action === 'pause') {
        setManuallyPaused(true);
        media?.pause();
        youtube('pauseVideo');
      } else if (action === 'play') {
        if (!gamePaused) {
          setManuallyPaused(false);
          if (media) void media.play().catch(() => {});
          youtube('playVideo');
        }
      } else if ((action === 'seek' || action === 'seekTo') && typeof value === 'number' && Number.isFinite(value)) {
        const currentTime = media ? media.currentTime : youtubeTime.current;
        const duration = media ? media.duration : youtubeDuration.current;
        const target = Math.max(0, Math.min(action === 'seekTo' ? value : currentTime + value, duration && Number.isFinite(duration) ? duration : Infinity));
        if (media) media.currentTime = target;
        else {
          youtubeTime.current = target;
          youtube('seekTo', [target, true]);
        }
      }
    }
    window.addEventListener('board-media-command', command);
    return () => window.removeEventListener('board-media-command', command);
  }, [controlId, gamePaused]);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media || !controlId) return;
    const events = ['playing', 'pause', 'ended', 'loadedmetadata', 'error', 'seeked', 'ratechange', 'timeupdate'];
    for (const event of events) media.addEventListener(event, reportPlayback);
    reportPlayback();
    return () => { for (const event of events) media.removeEventListener(event, reportPlayback); };
  }, [controlId, mediaType, mediaUrl]);

  useEffect(() => {
    if (!controlId || !['audio', 'video', 'youtube'].includes(mediaType ?? '')) return;
    const timer = window.setInterval(reportPlayback, 500);
    return () => window.clearInterval(timer);
  }, [controlId, mediaType, mediaUrl]);

  if (!mediaUrl) return null;
  if (mediaType === 'image') {
    return <LoadingImage src={mediaUrl} alt="clue" className="max-h-[60dvh] mb-6 rounded w-full" />;
  }
  if (mediaType === 'audio') {
    return <audio ref={element => { mediaRef.current = element; }} src={mediaUrl} autoPlay={!paused} controls={!hideAudioPlayer} hidden={hideAudioPlayer} aria-label={audioLabel}
      onPlaying={onPlaying} onEnded={onEnded} onError={() => onPlaybackProblem?.('The recording could not be played. Open buzzers manually from the host to continue.')}
      className="mb-6 w-full max-w-2xl" />;
  }
  if (mediaType === 'video') {
    return <video ref={element => { mediaRef.current = element; }} src={mediaUrl} autoPlay={!paused} playsInline controls style={{ visibility: hideVideo ? 'hidden' : 'visible' }} aria-hidden={hideVideo} aria-label="Clue video" className="max-h-[60dvh] object-contain mb-6 rounded w-full" />;
  }
  if (mediaType === 'youtube') {
    const src = new URL(getYouTubeEmbedUrl(mediaUrl));
    src.searchParams.set('enablejsapi', '1');
    src.searchParams.set('autoplay', initiallyPaused.current ? '0' : '1');
    return (
      <div style={{ visibility: hideVideo ? 'hidden' : 'visible' }} aria-hidden={hideVideo} className="mb-6 w-full aspect-video max-h-[60dvh]">
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
