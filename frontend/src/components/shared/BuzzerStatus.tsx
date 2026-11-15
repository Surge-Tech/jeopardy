import type { GameState } from '@shared/types';
import { getCompetitor } from '@shared/competitors';
import { hasPendingAnswer } from '@shared/questionFlow';
import AnswerCountdown from './AnswerCountdown';

export default function BuzzerStatus({ gameState, display = false, personal = false }: {
  gameState: GameState;
  display?: boolean;
  personal?: boolean;
}) {
  if (gameState.dailyDouble) {
    return <AnswerCountdown gameState={gameState} sound={display} />;
  }
  const open = gameState.buzzerState === 'open';
  const player = gameState.buzzedPlayerId ? getCompetitor(gameState, gameState.buzzedPlayerId) : undefined;
  const pending = hasPendingAnswer(gameState);
  if (!open && !gameState.buzzedPlayerId) return null;
  return (
    <div className={`buzzer-status ${open ? 'buzzer-status--open' : 'buzzer-status--answering'} ${display ? 'buzzer-status--display' : ''}`}>
      <div className="buzzer-status__identity" role="status">
        {open ? (
          <span className="buzzer-status__signal" aria-hidden="true"><span /></span>
        ) : (
          <span className="buzzer-status__avatar" style={{ backgroundColor: player?.color ?? '#FFD700' }} aria-hidden="true">
            {(gameState.buzzedPlayerName ?? '?').trim().slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="min-w-0">
          {!open && pending && <div className="buzzer-status__eyebrow">{personal ? 'You buzzed in' : 'Buzzed in'}</div>}
          <div className="buzzer-status__title">{open ? 'Buzzers open' : gameState.buzzedPlayerName}</div>
          {!open && pending && personal && <div className="buzzer-status__hint">Your turn to answer</div>}
        </div>
      </div>
      {!open && <AnswerCountdown gameState={gameState} sound={display} />}
    </div>
  );
}
