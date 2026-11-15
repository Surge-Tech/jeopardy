import type { GameState } from '@shared/types';
import { hasPendingAnswer } from '@shared/questionFlow';
import { useCountdown } from '../final/useCountdown';
import CountdownDial from './CountdownDial';
import { useEffect, useRef } from 'react';
import { playTimesUp } from '../../utils/sounds';

export default function AnswerCountdown({ gameState, sound = false }: { gameState: GameState; sound?: boolean }) {
  const dd = gameState.dailyDouble;
  const ddTimer = dd && gameState.dailyDoubleRevealed && !dd.outcome ? dd.timer : null;
  const timer = !gameState.responseVisible ? (dd ? ddTimer : hasPendingAnswer(gameState) ? gameState.answerTimer : null) : null;
  const remainingMs = useCountdown(timer?.deadline ?? null, timer?.serverNow ?? null);
  const previous = useRef<{ key: string; remainingMs: number | null } | null>(null);
  const timerKey = timer ? JSON.stringify([gameState.activeQuestionId, dd?.playerId ?? gameState.buzzedPlayerId, timer.deadline]) : null;
  useEffect(() => {
    if (sound && timerKey && previous.current?.key === timerKey &&
      previous.current.remainingMs != null && previous.current.remainingMs > 0 && remainingMs === 0) {
      playTimesUp();
    }
    previous.current = timerKey ? { key: timerKey, remainingMs } : null;
  }, [sound, timerKey, remainingMs]);
  if (!timer || remainingMs == null) return null;
  const seconds = Math.ceil(remainingMs / 1000);
  const totalMs = timer.deadline - (ddTimer?.startedAt ?? gameState.buzzTimestamp ?? timer.serverNow);
  return (
    <CountdownDial remainingMs={remainingMs} totalMs={totalMs}
      ariaLabel={dd ? 'Daily Double countdown' : 'Answer countdown'}
      label={seconds === 0 ? 'Time’s up!' : 'Answer time'} />
  );
}
