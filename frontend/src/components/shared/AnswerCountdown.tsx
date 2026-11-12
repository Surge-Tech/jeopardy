import type { GameState } from '@shared/types';
import { hasPendingAnswer } from '@shared/questionFlow';
import { useCountdown } from '../final/useCountdown';

export default function AnswerCountdown({ gameState }: { gameState: GameState }) {
  const timer = !gameState.responseVisible && hasPendingAnswer(gameState) ? gameState.answerTimer : null;
  const remainingMs = useCountdown(timer?.deadline ?? null, timer?.serverNow ?? null);
  if (!timer || remainingMs == null) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  const totalMs = timer.deadline - (gameState.buzzTimestamp ?? timer.serverNow);
  const remaining = Math.min(1, Math.max(0, remainingMs / Math.max(1, totalMs)));
  return (
    <div role="timer" aria-label="Answer countdown" className={`answer-clock ${seconds <= 3 ? 'answer-clock--urgent' : ''}`}>
      <div className="answer-clock__dial">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle className="answer-clock__track" cx="32" cy="32" r="28" />
          <circle className="answer-clock__progress" cx="32" cy="32" r="28" pathLength="100"
            strokeDasharray="100" strokeDashoffset={100 * (1 - remaining)} />
        </svg>
        <span className="answer-clock__number">{seconds}</span>
      </div>
      <span className="answer-clock__label">{seconds === 0 ? 'Time’s up!' : 'Answer time'}</span>
    </div>
  );
}
