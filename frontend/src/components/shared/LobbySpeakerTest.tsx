import { useEffect, useRef, useState } from 'react';
import { SPEAKER_TEST_MEDIA_ID, type MediaCommand, type MediaPlaybackStatus } from '@shared/mediaControls';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { socket } from '../../socket';

const BLOCKED_MESSAGE = 'Click anywhere on the board view to enable sound, then try again.';

// Only the projected board produces sound. The host uses the same command and
// status relay as clue media, so the test checks the speakers used during play.
export default function LobbySpeakerTest({ roomCode }: { roomCode?: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const errorRef = useRef<string>();
  const [status, setStatus] = useState<MediaPlaybackStatus | null>(null);

  function report() {
    const audio = audioRef.current;
    if (!audio) return;
    const next = { mediaId: SPEAKER_TEST_MEDIA_ID, playing: !audio.paused && !audio.ended, error: errorRef.current };
    setStatus(next);
    window.dispatchEvent(new window.CustomEvent('board-media-status', { detail: next }));
  }

  function stop() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    errorRef.current = undefined;
    report();
  }

  function play() {
    const audio = audioRef.current;
    if (!audio) return;
    errorRef.current = undefined;
    audio.currentTime = 0;
    void audio.play().then(report).catch(error => {
      // A stop or lobby exit can interrupt a pending play request.
      if (error?.name === 'AbortError') return;
      errorRef.current = error?.name === 'NotAllowedError' ? BLOCKED_MESSAGE : 'The speaker test could not be played. Try again.';
      report();
    });
  }

  useEffect(() => {
    if (roomCode) {
      function update(next: MediaPlaybackStatus) {
        if (next.mediaId === SPEAKER_TEST_MEDIA_ID) setStatus(next);
      }
      function requestStatus() {
        socket.emit(SOCKET_EVENTS.HOST_MEDIA_COMMAND, { roomCode, mediaId: SPEAKER_TEST_MEDIA_ID, action: 'status' });
      }
      socket.on(SOCKET_EVENTS.BOARD_MEDIA_STATUS, update);
      socket.on('connect', requestStatus);
      requestStatus();
      return () => {
        socket.off(SOCKET_EVENTS.BOARD_MEDIA_STATUS, update);
        socket.off('connect', requestStatus);
      };
    }
    const audio = audioRef.current;
    function command(event: Event) {
      const detail = (event as CustomEvent<MediaCommand>).detail;
      if (detail.mediaId !== SPEAKER_TEST_MEDIA_ID) return;
      if (detail.action === 'play') play();
      else if (detail.action === 'pause') stop();
      else if (detail.action === 'status') report();
    }
    window.addEventListener('board-media-command', command);
    report();
    return () => {
      window.removeEventListener('board-media-command', command);
      audio?.pause();
    };
  }, [roomCode]);

  function send(action: 'play' | 'pause') {
    if (roomCode) {
      socket.emit(SOCKET_EVENTS.HOST_MEDIA_COMMAND, { roomCode, mediaId: SPEAKER_TEST_MEDIA_ID, action });
    } else if (action === 'play') play();
    else stop();
  }

  if (!roomCode) return <audio ref={audioRef} src="/audio/speaker-test-da.mp3" preload="none" hidden aria-label="Speaker test recording"
    onPlaying={report} onPause={report} onEnded={report} onError={() => {
      errorRef.current = 'The speaker test recording could not be loaded. Try again.';
      report();
    }} />;

  return <section aria-label="Lobby speaker test" className="rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-3">
    <h2 className="text-xl font-bold text-jeopardy-gold">Speaker test</h2>
    <div className="flex flex-wrap gap-2">
      <button className="btn-primary text-sm" title={status?.error} onClick={() => send('play')}>{status?.playing ? 'Replay speaker test' : 'Test speakers'}</button>
    </div>
  </section>;
}
