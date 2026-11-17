import type { GameState } from '@shared/types';
import BuzzerStatus from './BuzzerStatus';
import BuzzResults from './BuzzResults';

export default function BoardBuzzerDock({ gameState }: { gameState: GameState }) {
  const lobby = gameState.phase === 'lobby';
  return <div className={`board-buzzer-dock${lobby ? ' board-buzzer-dock--lobby' : ''}`}
    aria-label={lobby ? 'Lobby buzzer test' : undefined}>
    <div className="board-buzzer-dock__status"><BuzzerStatus gameState={gameState} display /></div>
    {!gameState.buzzWindow && gameState.buzzHistory?.length > 0 && (
      <div className="board-buzz-order">
        <BuzzResults entries={gameState.buzzHistory} winnerId={gameState.buzzedPlayerId} />
      </div>
    )}
  </div>;
}
