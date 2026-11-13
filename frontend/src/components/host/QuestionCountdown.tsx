import type { GameState } from '@shared/types';
import { useCountdown } from '../final/useCountdown';
import CountdownDial from '../shared/CountdownDial';

export default function QuestionCountdown({ gameState }: { gameState: GameState }) {
  const timer = gameState.activeQuestionId && !gameState.dailyDouble && !gameState.finalJeopardy
    && !gameState.responseVisible ? gameState.questionTimer : null;
  const remaining = useCountdown(timer?.deadline ?? null, timer?.serverNow ?? null);
  if (!timer) return null;
  const remainingMs = timer.deadline === null ? timer.remainingMs : remaining ?? Math.max(0, timer.deadline - timer.serverNow);
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800 px-4 py-3">
      <div>
        <div className="text-sm text-gray-300">Waiting for answers</div>
        <div className="text-xs text-gray-400">{seconds === 0 ? 'Time elapsed' : timer.deadline === null ? 'Paused' : '30-second countdown'}</div>
      </div>
      <CountdownDial remainingMs={remainingMs} totalMs={30000} ariaLabel="Question countdown"
        label={seconds === 0 ? 'Time elapsed' : timer.deadline === null ? 'Paused' : 'Waiting time'} />
    </div>
  );
}
