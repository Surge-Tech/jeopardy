import { useState } from 'react';
import type { GameState } from '@shared/types';
import { SOCKET_EVENTS as E, type SocketEventName } from '@shared/socketEvents';
import { hasPendingAnswer } from '@shared/questionFlow';
import { socket } from '../../socket';
import { formatScore } from '../../utils/format';
import { getStartGameError } from '@shared/lobby';
import { LIMITS } from '@shared/limits';

export default function TeamsPanel({ gameState, roomCode }: { gameState: GameState; roomCode: string }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#60a5fa');
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null);
  const [error, setError] = useState('');
  const lobby = gameState.phase === 'lobby';
  const startError = getStartGameError(gameState);
  const [starting, setStarting] = useState(false);
  const teams = gameState.teams ?? [];
  const captainLocked = !lobby && (gameState.phase === 'finished' || hasPendingAnswer(gameState)
    || (!!gameState.activeQuestionId && gameState.dailyDouble?.stage !== 'wagering'));

  function send(event: SocketEventName, payload: object, onSuccess?: () => void) {
    socket.emit(event, { roomCode, ...payload }, (res: { ok: boolean; error?: string }) => {
      setError(res.ok ? '' : res.error ?? 'Could not update teams');
      if (res.ok) onSuccess?.();
    });
  }
  function save() {
    send(E.HOST_SAVE_TEAM, { name, color }, () => setName(''));
  }

  return (
    <div className="space-y-3 mb-4">
      {lobby && <label className="flex items-center justify-between text-sm font-bold">
        Game mode
        <select aria-label="Game mode" className="input-field w-auto" value={gameState.mode ?? 'teams'}
          onChange={e => send(E.HOST_SET_MODE, { mode: e.target.value })}>
          <option value="individual">Individual</option><option value="teams">Teams</option>
        </select>
      </label>}
      {gameState.mode === 'teams' && <>
        <p className="text-xs text-gray-400">{lobby
          ? 'Assign every player to a team. Each team needs a captain. Setup locks when play starts.'
          : 'Shared team scores. Captains submit wagers and Final Jeopardy answers.'}</p>
        {lobby && <div className="space-y-2">
          <input aria-label="Team name" className="input-field text-sm" placeholder="Team name" value={name}
            maxLength={LIMITS.PLAYER_NAME_MAX} onChange={e => setName(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} />
          <div className="flex items-center gap-2">
            <input aria-label="Team color" type="color" value={color} onChange={e => setColor(e.target.value)} />
            <button className="btn-primary text-xs" onClick={save}>Add team</button>
          </div>
        </div>}
        {teams.map(team => <div key={team.id} className="bg-gray-800 rounded-lg p-3 space-y-2" style={{ borderLeft: `4px solid ${team.color}` }}>
          <div className="flex justify-between items-start gap-2">
            {lobby && editing?.id === team.id ? (
              <form className="flex-1 min-w-0 space-y-2" aria-label={`Edit ${team.name}`}
                onSubmit={event => {
                  event.preventDefault();
                  send(E.HOST_SAVE_TEAM, editing, () => setEditing(null));
                }} onKeyDown={event => {
                  if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
                }}>
                <input autoFocus aria-label={`Name for ${team.name}`} className="input-field text-sm"
                  value={editing.name} maxLength={LIMITS.PLAYER_NAME_MAX}
                  onChange={event => setEditing({ ...editing, name: event.target.value })} />
                <div className="flex flex-wrap items-center gap-2">
                  <input aria-label={`Color for ${team.name}`} type="color" value={editing.color}
                    onChange={event => setEditing({ ...editing, color: event.target.value })} />
                  <button type="submit" className="btn-primary text-xs">Save team</button>
                  <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </form>
            ) : <strong className="break-words">{team.name}</strong>}
            {!lobby && <span className="text-jeopardy-gold font-bold">{formatScore(team.score)}</span>}
          </div>
          <label className="text-xs flex items-center gap-2">Captain
            <select aria-label={`Captain for ${team.name}`} className="input-field text-xs flex-1" value={team.captainPlayerId ?? ''} disabled={captainLocked}
              onChange={e => send(E.HOST_SET_CAPTAIN, { teamId: team.id, playerId: e.target.value })}>
              <option value="" disabled>Choose captain</option>
              {gameState.players.filter(p => p.teamId === team.id).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <p className="text-xs text-gray-400">{gameState.players.filter(p => p.teamId === team.id).map(p => p.name).join(', ') || 'No members'}</p>
          <div className="flex gap-2">
            {!lobby && <button className="btn-ghost text-xs" onClick={() => send(E.HOST_SCORE, { playerId: team.id, delta: 100 })}>+100</button>}
            {!lobby && <button className="btn-ghost text-xs" onClick={() => send(E.HOST_SCORE, { playerId: team.id, delta: -100 })}>−100</button>}
            {lobby && <>
              {editing?.id !== team.id && <button className="btn-ghost text-xs py-1.5 px-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jeopardy-gold"
                onClick={() => setEditing({ id: team.id, name: team.name, color: team.color })}>Edit</button>}
              <button className="border-2 border-red-400 text-red-400 font-bold text-xs py-1.5 px-3 rounded hover:bg-red-400 hover:text-gray-950 active:scale-95 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-400"
                onClick={() => send(E.HOST_REMOVE_TEAM, { teamId: team.id })}>Delete</button>
            </>}
          </div>
        </div>)}
        {lobby && <div className="space-y-2">
          <button className="btn-ghost w-full text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={teams.length < 2 || gameState.players.length < teams.length}
            onClick={() => send(E.HOST_AUTO_ASSIGN_TEAMS, {})}>Auto-assign players</button>
          <p className="text-xs text-gray-400">{teams.length < 2
            ? 'Create at least two teams to auto-assign players.'
            : gameState.players.length < teams.length
              ? 'Add enough players for every team to have a member.'
              : 'Shuffle all players into balanced teams and choose new captains. Click again to reshuffle.'}</p>
        </div>}
        {lobby && gameState.players.map(player => <label key={player.id} className="flex items-center gap-2 text-sm">
          <span className="flex-1 truncate">{player.name}</span>
          <select aria-label={`Team for ${player.name}`} className="input-field text-xs w-40" value={player.teamId ?? ''}
            onChange={e => send(E.HOST_ASSIGN_TEAM, { playerId: player.id, teamId: e.target.value || null })}>
            <option value="">Unassigned</option>{teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>)}
      </>}
      {lobby && <div className="space-y-2">
        <p role="status" className={`text-sm ${startError ? 'text-gray-300' : 'text-jeopardy-gold'}`}>{startError ?? 'Ready to start. Everyone is in!'}</p>
        <button className="btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!!startError || starting} onClick={() => {
            setStarting(true);
            socket.timeout(5000).emit(E.HOST_START, { roomCode }, (timeoutError: Error | null, res?: { ok: boolean; error?: string }) => {
              setStarting(false);
              setError(timeoutError ? 'Could not reach the server. Please try again.' : res?.ok ? '' : res?.error ?? 'Could not start game');
            });
          }}>{starting ? 'Starting…' : 'Start game'}</button>
      </div>}
      {error && <p role="alert" className="text-red-400 text-sm">{error}</p>}
    </div>
  );
}
