import { useState } from 'react';
import type { GameState, Question } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { socket } from '../../socket';
import ClueMedia from './ClueMedia';

// Mounted once per selected question. Normal readings are tracked by the
// server so a refreshed board cannot replay a completed reading or open a
// later question's buzzers. Daily Doubles have no buzzer to open.
export default function QuestionClueMedia({ question, gameState, roomCode }: {
  question: Question; gameState: GameState; roomCode: string;
}) {
  const [finished, setFinished] = useState(false);
  const [problem, setProblem] = useState('');
  const reading = !!question.clueAudioUrl && !gameState.responseVisible && (
    question.isDailyDouble ? !finished : !!gameState.clueRecordingId
  );
  const showMedia = !gameState.responseVisible || !question.responseMediaUrl ||
    !['audio', 'video', 'youtube'].includes(question.responseMediaType ?? '') || question.mediaType === 'image';

  return <>
    {reading && <div className="mb-4 w-full max-w-2xl text-center">
      <p className="mb-2 text-sm text-gray-300">Reading clue…{!question.isDailyDouble && ' Buzzers open when the recording ends.'}</p>
      <ClueMedia key={gameState.clueRecordingId ?? question.id} mediaType="audio" mediaUrl={question.clueAudioUrl}
        controlId={`${question.id}:recording`} audioLabel="Clue recording" paused={false} hideVideo={false}
        onPlaybackProblem={setProblem}
        onEnded={() => {
          setFinished(true);
          if (gameState.clueRecordingId) socket.emit(SOCKET_EVENTS.HOST_CLUE_RECORDING_ENDED, {
            roomCode, questionId: question.id, recordingId: gameState.clueRecordingId,
          });
        }} />
      {problem && <p role="alert" className="text-sm text-yellow-300">{problem}</p>}
    </div>}
    {showMedia && <ClueMedia controlId={`${question.id}:clue`} key={`${question.id}:${question.mediaUrl}`} {...question}
      paused={reading || (!gameState.responseVisible && !!gameState.buzzedPlayerId)}
      hideVideo={!!gameState.buzzedPlayerId && !gameState.responseVisible} />}
  </>;
}
