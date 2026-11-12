import { useEffect, useState } from 'react';
import type { GameState, Player } from '@shared/types';
import { PERMANENT_LOCKOUT } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { socket } from '../../socket';

function disabledReason(state: GameState, player: Player, now: number): string | null {
  if (state.phase === 'finished') return 'Game finished';
  if (state.finalJeopardy) return 'Buzzers are off during Final Jeopardy';
  if (state.dailyDouble) return 'Buzzers are off during Daily Doubles';
  if (!state.activeQuestionId) return 'Open a clue to test buzzing';
  if (state.mode === 'teams' && !state.teams.some(team => team.id === player.teamId)) return 'Assign this player to a team';
  const until = state.buzzLockouts[player.id];
  if (until === PERMANENT_LOCKOUT) return 'Locked out for this clue';
  if (until > now) return 'Early-buzz penalty active';
  if (state.buzzerState === 'locked') {
    if (state.buzzHistory.some(entry => entry.playerId === player.id)) return 'Already buzzed';
    if (!state.buzzWindow || now >= state.buzzWindow.deadline) return 'Buzz window closed';
  }
  return null;
}

const feedback: Record<string, string> = {
  won: 'Buzz won', early: 'Too early', 'locked-out': 'Locked out',
  recorded: 'Late buzz recorded', ignored: 'Buzz not accepted',
};

export default function TestBuzzerButton({ gameState, player, roomCode, now }: {
  gameState: GameState; player: Player; roomCode: string; now: number;
}) {
  const [message, setMessage] = useState('');
  const reason = disabledReason(gameState, player, now);
  useEffect(() => { setMessage(''); }, [gameState.activeQuestionId]);

  function buzz() {
    socket.emit(SOCKET_EVENTS.HOST_BUZZ_PLAYER, { roomCode, playerId: player.id },
      (res: { ok: boolean; error?: string; outcome?: string }) => {
        setMessage(res.ok ? feedback[res.outcome ?? ''] ?? 'Buzz sent' : res.error ?? 'Could not buzz');
      });
  }

  return <div className="space-y-1">
    <button className="btn-ghost w-full text-xs disabled:opacity-40 disabled:cursor-not-allowed"
      aria-label={`Test buzzer for ${player.name}`} title={reason ?? 'Simulate a buzz for this player'}
      disabled={!!reason} onClick={buzz}>
      {gameState.buzzerState === 'idle' && !reason ? 'Test early buzz' : 'Test buzzer'}
    </button>
    {(reason || message) && <p role="status" className="text-xs text-gray-400">{reason ?? message}</p>}
  </div>;
}
