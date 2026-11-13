import type { GameState } from '@shared/types';
import { hasPendingAnswer } from '@shared/questionFlow';
import { useCountdown } from '../final/useCountdown';
import CountdownDial from './CountdownDial';

export default function AnswerCountdown({ gameState }: { gameState: GameState }) {
  const dd = gameState.dailyDouble;
  const ddTimer = dd && gameState.dailyDoubleRevealed && !dd.outcome ? dd.timer : null;
  const timer = !gameState.responseVisible ? (dd ? ddTimer : hasPendingAnswer(gameState) ? gameState.answerTimer : null) : null;
  const remainingMs = useCountdown(timer?.deadline ?? null, timer?.serverNow ?? null);
  if (!timer || remainingMs == null) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  const totalMs = timer.deadline - (ddTimer?.startedAt ?? gameState.buzzTimestamp ?? timer.serverNow);
  return (
    <CountdownDial remainingMs={remainingMs} totalMs={totalMs}
      ariaLabel={dd ? 'Daily Double countdown' : 'Answer countdown'}
      label={seconds === 0 ? 'Time’s up!' : 'Answer time'} />
  );
}
