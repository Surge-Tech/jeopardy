import type { GameState } from '@shared/types';
import BuzzResults from './BuzzResults';

export default function LobbyBuzzerTest({ gameState, onAction }: {
  gameState: GameState;
  onAction?: (action: 'open' | 'reset') => void;
}) {
  return <section aria-label="Lobby buzzer test" className="rounded-xl border border-gray-700 bg-gray-900 p-4 space-y-3">
    <h2 className="text-xl font-bold text-jeopardy-gold">Buzzer test</h2>
    {!onAction && <p role="status" className="text-gray-300">
      {gameState.buzzerState === 'open' ? 'Buzzers open — try your buzzer!'
        : gameState.buzzedPlayerId ? `${gameState.buzzedPlayerName} buzzed first!`
        : 'Test your phone buzzers before the game.'}
    </p>}
    {onAction && <>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary text-sm disabled:opacity-40" disabled={!gameState.players.length || gameState.buzzerState !== 'idle'}
          onClick={() => onAction('open')}>Open buzzers</button>
        <button className="btn-ghost text-sm" onClick={() => onAction('reset')}>Reset test</button>
      </div>
    </>}
    {!onAction && gameState.buzzWindow && <p className="text-sm text-gray-400">Collecting buzzes…</p>}
    <BuzzResults entries={gameState.buzzHistory} winnerId={gameState.buzzedPlayerId} />
  </section>;
}
