import BoardMediaPreview from './BoardMediaPreview';
import type { Board, GameState } from '@shared/types';
import { useEffect, useState } from 'react';
import type { MediaAction, MediaPlaybackStatus } from '@shared/mediaControls';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { socket } from '../../socket';

export default function BoardMediaControls({ board, gameState, roomCode }: { board: Board; gameState: GameState; roomCode: string }) {
  const fj = gameState.finalJeopardy;
  const question = board.rounds[gameState.currentRoundIndex]?.categories.flatMap(c => c.questions)
    .find(q => q.id === gameState.activeQuestionId);
  let mediaId: string;
  let type: string | undefined;
  let url: string | undefined;
  let answering = false;
  let response = false;
  if (gameState.phase !== 'playing') return null;
  if (fj) {
    const responseStage = fj.stage === 'response';
    response = responseStage && !!fj.responseMediaUrl && ['audio', 'video', 'youtube'].includes(fj.responseMediaType ?? '');
    if (!responseStage && fj.stage !== 'clue' && fj.stage !== 'answering') return null;
    mediaId = `final:${response ? 'response' : 'clue'}`;
    type = response ? fj.responseMediaType : fj.mediaType;
    url = response ? fj.responseMediaUrl : fj.mediaUrl;
  } else {
    if (!question || (question.isDailyDouble
      ? !gameState.dailyDoubleRevealed || (gameState.dailyDouble && gameState.dailyDouble.stage !== 'ready')
      : !gameState.clueVisible)) return null;
    response = gameState.responseVisible && !!question.responseMediaUrl && ['audio', 'video', 'youtube'].includes(question.responseMediaType ?? '');
    mediaId = `${question.id}:${response ? 'response' : 'clue'}`;
    type = response ? question.responseMediaType : question.mediaType;
    url = response ? question.responseMediaUrl : question.mediaUrl;
    answering = !gameState.responseVisible && !!gameState.buzzedPlayerId;
    if (gameState.clueRecordingId && question.clueAudioUrl && !gameState.responseVisible) {
      mediaId = `${question.id}:recording`;
      type = 'audio';
      url = question.clueAudioUrl;
    }
  }
  if (!url || !['audio', 'video', 'youtube'].includes(type ?? '')) return null;
  return <MediaPlayerControls key={mediaId} roomCode={roomCode} mediaId={mediaId} answering={answering} type={type!} url={url} />;
}

function MediaPlayerControls({ roomCode, mediaId, answering, type, url }: {
  roomCode: string; mediaId: string; answering: boolean; type: string; url: string;
}) {
  const [status, setStatus] = useState<MediaPlaybackStatus | null>(null);
  useEffect(() => {
    function update(status: MediaPlaybackStatus) {
      if (status.mediaId === mediaId) setStatus(status);
    }
    function requestStatus() {
      socket.emit(SOCKET_EVENTS.HOST_MEDIA_COMMAND, { roomCode, mediaId, action: 'status' });
    }
    socket.on(SOCKET_EVENTS.BOARD_MEDIA_STATUS, update);
    socket.on('connect', requestStatus);
    requestStatus();
    return () => {
      socket.off(SOCKET_EVENTS.BOARD_MEDIA_STATUS, update);
      socket.off('connect', requestStatus);
    };
  }, [roomCode, mediaId]);
  function send(action: MediaAction, value?: number) {
    socket.emit(SOCKET_EVENTS.HOST_MEDIA_COMMAND, { roomCode, mediaId, action, value });
  }
  const isPlaying = !answering && status?.playing === true;
  const toggleLabel = isPlaying ? 'Pause' : 'Play';
  const skipClass = 'flex h-11 w-11 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jeopardy-gold';
  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800 to-gray-950 p-4 shadow-lg" aria-label="Board media controls">
      <div className="mb-2 text-xs text-gray-400">Board playback · muted preview</div>
      <BoardMediaPreview type={type} url={url} status={status} />
      {status?.duration !== undefined && status.duration > 0 && <input type="range" min={0} max={status.duration}
        step={0.1} value={Math.min(status.currentTime ?? 0, status.duration)} aria-label="Board playback position"
        className="mb-3 w-full accent-yellow-400" onChange={event => send('seekTo', Number(event.target.value))} />}
      <div className="flex items-center justify-center gap-5">
        <button className={skipClass} aria-label="Skip back 10 seconds" title="Skip back 10 seconds" onClick={() => send('seek', -10)}><SkipIcon /></button>
        <button className="flex h-14 w-14 items-center justify-center rounded-full bg-jeopardy-gold text-gray-950 shadow-lg shadow-yellow-500/10 transition hover:scale-105 hover:bg-yellow-300 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-4 focus-visible:ring-offset-slate-900 disabled:scale-100 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={toggleLabel} title={toggleLabel} disabled={answering} onClick={() => send(isPlaying ? 'pause' : 'play')}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d={isPlaying ? 'M6 4h4v16H6zm8 0h4v16h-4z' : 'M8 4v16l13-8z'} />
          </svg>
        </button>
        <button className={skipClass} aria-label="Skip forward 10 seconds" title="Skip forward 10 seconds" onClick={() => send('seek', 10)}><SkipIcon forward /></button>
      </div>
    </section>
  );
}

function SkipIcon({ forward = false }: { forward?: boolean }) {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M3 10a9 9 0 1 1 1 8M3 4v6h6" transform={forward ? 'translate(24 0) scale(-1 1)' : undefined} />
    <text x="12" y="16" textAnchor="middle" fill="currentColor" stroke="none" fontSize="9" fontWeight="bold">10</text>
  </svg>;
}
