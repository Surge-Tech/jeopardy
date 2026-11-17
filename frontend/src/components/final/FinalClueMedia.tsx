import { useState } from 'react';
import type { FinalPublicState } from '@shared/types';
import ClueMedia from '../shared/ClueMedia';

export default function FinalClueMedia({ finalJeopardy: fj, onRecordingEnded }: {
  finalJeopardy: FinalPublicState; onRecordingEnded?: (recordingId: string) => void;
}) {
  const [problem, setProblem] = useState('');
  const reading = fj.stage === 'clue' && !!fj.clueRecordingId && !!fj.clueAudioUrl;
  return <>
    {reading && <div className="mb-4">
      <ClueMedia key={fj.clueRecordingId} mediaType="audio" mediaUrl={fj.clueAudioUrl}
        controlId="final:recording" audioLabel="Clue recording" paused={false} hideVideo={false}
        onPlaybackProblem={message => setProblem(message.startsWith('Press play')
          ? 'Press play on the board or host to start the recording.'
          : 'The recording could not be played. Start the answer timer from the host to continue.')}
        onPlaying={() => setProblem('')}
        onEnded={() => { if (fj.clueRecordingId) onRecordingEnded?.(fj.clueRecordingId); }} />
      {problem && <p role="alert" className="text-sm text-yellow-300">{problem}</p>}
      {problem.startsWith('Press play') && <button className="btn-ghost mt-2" onClick={() => {
        window.dispatchEvent(new CustomEvent('board-media-command', { detail: { mediaId: 'final:recording', action: 'play' } }));
      }}>Play recording</button>}
    </div>}
    <ClueMedia mediaType={fj.mediaType} mediaUrl={fj.mediaUrl} paused={reading} hideVideo={false} controlId="final:clue" />
  </>;
}
