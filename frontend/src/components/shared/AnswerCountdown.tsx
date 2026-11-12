import type { GameState } from '@shared/types';
import { hasPendingAnswer } from '@shared/questionFlow';
import { useCountdown } from '../final/useCountdown';

export default function AnswerCountdown({ gameState }: { gameState: GameState }) {
  const timer = hasPendingAnswer(gameState) ? gameState.answerTimer : null;
  const remainingMs = useCountdown(timer?.deadline ?? null, timer?.serverNow ?? null, 'second');
  if (!timer || remainingMs == null) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  return (
    <div role="timer" aria-label="Answer countdown"
      className={`my-3 text-center text-2xl font-black tabular-nums ${seconds <= 3 ? 'text-red-400' : 'text-jeopardy-gold'}`}>
      {seconds === 0 ? 'Time’s up!' : `Answer: ${seconds}s`}
    </div>
  );
}
