import { getCompetitor, getCompetitors, getTeam, playerLabel } from '@shared/competitors';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket';
import { useGameStore } from '../store/gameStore';
import type { GameState } from '@shared/types';
import { PERMANENT_LOCKOUT } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { LIMITS } from '@shared/limits';
import PlayerFinal from '../components/final/PlayerFinal';
import DDPlayerWager from '../components/dailydouble/DDPlayerWager';
import Leaderboard from '../components/shared/Leaderboard';
import BuzzerStatus from '../components/shared/BuzzerStatus';
import { hasPendingAnswer } from '@shared/questionFlow';
import { randomPlayerColor } from '../utils/colors';
import { formatScore } from '../utils/format';

type BuzzerPhase = 'join' | 'lobby' | 'waiting' | 'armed' | 'open' | 'winner' | 'too-late' | 'locked-out' | 'incorrect' | 'finished' | 'closed';

function rejoinKey(roomCode: string | undefined) {
  return `jeopardy:player:${roomCode ?? ''}`;
}

export default function Buzzer() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const { gameState, setGameState, setMyPlayer } = useGameStore();
  const [buzzerPhase, setPhase] = useState<BuzzerPhase>('join');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [myId, setMyId] = useState('');
  const screenRef = useRef<HTMLDivElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [editNameError, setEditNameError] = useState('');

  // The on-screen keyboard can shrink the visual viewport without changing dvh.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    function resize() {
      if (viewport!.scale === 1) {
        screenRef.current?.style.setProperty('--player-viewport-height', `${viewport!.height}px`);
      }
    }
    resize();
    viewport.addEventListener('resize', resize);
    return () => viewport.removeEventListener('resize', resize);
  }, []);

  // Server lockouts take precedence over broadcasts and transient feedback.
  // Derive this from game state so it also survives a reconnect or page reload.
  const isIncorrect = !!gameState?.activeQuestionId
    && gameState.buzzLockouts[myId] === PERMANENT_LOCKOUT;
  const phase: BuzzerPhase = isIncorrect && gameState?.phase !== 'finished'
    && buzzerPhase !== 'join' && buzzerPhase !== 'closed'
    ? 'incorrect'
    : gameState?.buzzedPlayerId === myId && hasPendingAnswer(gameState)
      && gameState.phase !== 'finished' && buzzerPhase !== 'join' && buzzerPhase !== 'closed'
      ? 'winner' : buzzerPhase;

  // Kept in sync with `phase`/`myId` state below so the socket-handler effect
  // can read the current values without needing them in its dependency
  // array — the handlers only use them inside closures, they don't need to
  // be redefined (and the socket listeners re-registered) every time phase
  // or myId changes.
  const phaseRef = useRef(phase);
  const myIdRef = useRef(myId);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { myIdRef.current = myId; }, [myId]);

  // Try to rejoin (e.g. after a phone screen sleeps and drops the socket).
  useEffect(() => {
    if (!roomCode) return;
    function tryRejoin() {
      const savedId = localStorage.getItem(rejoinKey(roomCode));
      if (savedId) socket.emit(SOCKET_EVENTS.PLAYER_REJOIN, { roomCode, playerId: savedId });
    }
    tryRejoin();
    socket.on('connect', tryRejoin);
    return () => { socket.off('connect', tryRejoin); };
  }, [roomCode]);

  useEffect(() => {
    socket.on(SOCKET_EVENTS.GAME_STATE, (state: GameState) => {
      setGameState(state);
      if (state.phase === 'finished') { setPhase('finished'); return; }
      const currentPhase = phaseRef.current;
      if (state.buzzerState === 'locked' && currentPhase !== 'join' && currentPhase !== 'lobby' && currentPhase !== 'closed') {
        setWinnerName(state.buzzedPlayerName ?? 'Another player');
        if (state.buzzedPlayerId === myIdRef.current) setPhase('winner');
        else if (currentPhase !== 'locked-out') {
          const alreadyBuzzed = state.buzzHistory?.some(entry => entry.playerId === myIdRef.current);
          setPhase(state.buzzWindow && !alreadyBuzzed ? 'open' : 'too-late');
        }
        return;
      }
      const transient = currentPhase === 'locked-out';
      if (!state.finalJeopardy && currentPhase !== 'join' && currentPhase !== 'lobby' && currentPhase !== 'finished' && currentPhase !== 'closed' && !transient) {
        if (state.buzzerState === 'open') setPhase('open');
        else if (state.activeQuestionId) setPhase('armed');
        else setPhase('waiting');
      }
    });
    socket.on(SOCKET_EVENTS.PLAYER_JOINED, ({ player, state }: { player: { id: string; name: string }; state: GameState }) => {
      setMyId(player.id);
      setMyPlayer(player as any);
      setGameState(state);
      setWinnerName(state.buzzedPlayerName ?? 'Another player');
      if (state.buzzerState === 'locked') {
        const alreadyBuzzed = state.buzzHistory?.some(entry => entry.playerId === player.id);
        setPhase(state.buzzedPlayerId === player.id ? 'winner' : state.buzzWindow && !alreadyBuzzed ? 'open' : 'too-late');
      } else setPhase(state.buzzerState === 'open' ? 'open' : 'waiting');
      if (roomCode) localStorage.setItem(rejoinKey(roomCode), player.id);
    });
    socket.on(SOCKET_EVENTS.BUZZ_WINNER, ({ playerId, playerName }: { playerId: string; playerName: string }) => {
      if (playerId === myIdRef.current) {
        setWinnerName(playerName);
        setPhase('winner');
      } else {
        setWinnerName(playerName);
        setPhase('too-late');
      }
      setTimeout(() => setPhase(prev => prev === 'winner' || prev === 'too-late' ? 'waiting' : prev), 5000);
    });
    socket.on(SOCKET_EVENTS.BUZZ_RECORDED, () => setPhase('too-late'));
    socket.on(SOCKET_EVENTS.BUZZ_TOO_LATE, () => setPhase('too-late'));
    socket.on(SOCKET_EVENTS.BUZZ_LOCKED_OUT, ({ until }: { until: number }) => {
      // A wrong-answer lockout ends with the question, never with a timer.
      if (until === PERMANENT_LOCKOUT) return;
      setPhase('locked-out');
      const delay = Math.max(0, until - Date.now());
      setTimeout(() => setPhase(prev => prev === 'locked-out' ? 'armed' : prev), delay);
    });
    socket.on(SOCKET_EVENTS.BUZZER_OPEN, () => setPhase('open'));
    socket.on(SOCKET_EVENTS.BUZZER_LOCKED, () => setPhase(prev => prev === 'winner' || prev === 'too-late' || prev === 'locked-out' ? prev : 'waiting'));
    socket.on(SOCKET_EVENTS.GAME_ENDED, () => setPhase('closed'));
    socket.on('error', ({ message }: { message: string }) => setError(message));
    return () => {
      socket.off(SOCKET_EVENTS.GAME_STATE);
      socket.off(SOCKET_EVENTS.PLAYER_JOINED);
      socket.off(SOCKET_EVENTS.BUZZ_WINNER);
      socket.off(SOCKET_EVENTS.BUZZ_LOCKED_OUT);
      socket.off(SOCKET_EVENTS.BUZZ_RECORDED);
      socket.off(SOCKET_EVENTS.BUZZ_TOO_LATE);
      socket.off(SOCKET_EVENTS.BUZZER_OPEN);
      socket.off(SOCKET_EVENTS.BUZZER_LOCKED);
      socket.off(SOCKET_EVENTS.GAME_ENDED);
      socket.off('error');
    };
  }, [roomCode]);

  function joinGame() {
    if (!name.trim()) { setError('Enter your name'); return; }
    setError('');
    socket.emit(SOCKET_EVENTS.PLAYER_JOIN, { roomCode, name: name.trim(), color: randomPlayerColor() });
  }

  function buzz() {
    if (phase !== 'open' && phase !== 'armed') return;
    socket.emit(SOCKET_EVENTS.BUZZ);
    if (phase === 'open') setPhase('waiting');
  }

  function startEditName() {
    setEditNameValue(name);
    setEditNameError('');
    setEditingName(true);
  }

  function cancelEditName() {
    setEditingName(false);
    setEditNameError('');
  }

  function saveEditName() {
    const trimmed = editNameValue.trim();
    if (!trimmed) { setEditNameError('Name cannot be empty'); return; }
    socket.emit(SOCKET_EVENTS.PLAYER_RENAME, { newName: trimmed }, (res: { ok: boolean; error?: string }) => {
      if (res.ok) {
        setName(trimmed);
        setEditingName(false);
        setEditNameError('');
      } else {
        setEditNameError(res.error ?? 'Could not rename');
      }
    });
  }

  const myTeam = gameState ? getTeam(gameState, myId) : undefined;
  const waitingForTeam = gameState?.mode === 'teams' && !myTeam;
  const myScore = gameState ? getCompetitor(gameState, myId)?.score ?? 0 : 0;
  const isDDWagering = !!(gameState?.dailyDouble && gameState.dailyDouble.playerId === myId
    && gameState.dailyDouble.stage === 'wagering' && gameState.dailyDouble.hasDevice);

  const showBuzzer = phase !== 'join' && phase !== 'finished' && phase !== 'closed'
    && !gameState?.finalJeopardy && !isDDWagering;
  const canBuzz = !waitingForTeam && (phase === 'open' || phase === 'armed');
  const buttonLabel = {
    open: 'BUZZ!', armed: 'Wait...', waiting: 'Waiting...', lobby: 'Waiting...',
    winner: 'Answering', 'too-late': 'Too slow!', 'locked-out': 'Too early!', incorrect: 'Locked out',
  }[phase as Exclude<BuzzerPhase, 'join' | 'closed' | 'finished'>];
  const displayName = gameState ? playerLabel(gameState, myId) || name : name;

  const scoreboardRows = gameState && (
    <div className="space-y-1">
      {[...getCompetitors(gameState)].sort((a, b) => b.score - a.score).map(p => (
        <div key={p.id} className="flex justify-between items-center px-3 py-1 rounded bg-gray-900">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color }} />
            <span className={`text-sm break-words min-w-0 ${(p.id === myId || p.id === myTeam?.id) ? 'text-white font-bold' : 'text-gray-400'}`}>{p.name}</span>
          </div>
          <span className="font-bold text-sm shrink-0 ml-2" style={{ color: p.score < 0 ? '#ef4444' : '#FFD700' }}>
            {formatScore(p.score)}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div ref={screenRef} className={`player-screen bg-jeopardy-dark select-none ${showBuzzer ? 'player-buzzer-screen' : ''}`}>

      <header className="player-header">
        <div className="text-gray-400 text-xs">
          Room: <span className="text-jeopardy-gold font-bold tracking-widest">{roomCode}</span>
        </div>
        <div className="player-header__actions">
          {/* Name editor — lobby only */}
          {phase !== 'join' && phase !== 'finished' && phase !== 'closed' && gameState?.phase === 'lobby' && myId && (
            <div className={`player-name-editor ${editingName ? 'player-name-editor--editing' : ''}`}>
              {editingName ? (
                <div className="flex flex-col gap-2">
                  <input
                    autoFocus
                    className="input-field text-sm text-center"
                    value={editNameValue}
                    onChange={e => setEditNameValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveEditName(); if (e.key === 'Escape') cancelEditName(); }}
                    maxLength={LIMITS.PLAYER_NAME_MAX}
                  />
                  {editNameError && <p className="text-red-400 text-xs text-center">{editNameError}</p>}
                  <div className="flex gap-2 justify-center">
                    <button className="btn-primary text-xs py-1 px-3" onClick={saveEditName}>Save</button>
                    <button className="btn-ghost text-xs py-1 px-3" onClick={cancelEditName}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  className="text-xs text-gray-500 hover:text-gray-300 underline underline-offset-2 mx-auto block"
                  onClick={startEditName}
                >
                  ✎ Edit name
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="player-content" hidden={showBuzzer}>
        {/* JOIN phase */}
        {phase === 'join' && (
          <div className="w-full max-w-sm">
            <h1 className="text-4xl font-black text-jeopardy-gold text-center mb-8" style={{ textShadow: '2px 2px 0 #000' }}>
              JEOPARDY!
            </h1>
            <input
              autoFocus
              className="input-field text-xl py-4 text-center mb-4"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinGame()}
            />
            {error && <p className="text-red-400 text-center mb-3">{error}</p>}
            <button className="btn-primary w-full text-xl py-4" onClick={joinGame}>
              Join Game
            </button>
          </div>
        )}

        {/* Room closed by the host */}
        {phase === 'closed' && (
          <div className="text-center">
            <h2 className="text-3xl font-black text-jeopardy-gold mb-2">Room Closed</h2>
            <p className="text-gray-400">The host ended this game session.</p>
          </div>
        )}

        {/* Game finished — leaderboard */}
        {phase === 'finished' && gameState && (
          <Leaderboard gameState={gameState} compact myId={myId} />
        )}

        {/* Final Jeopardy takes over once it starts */}
        {phase !== 'join' && phase !== 'finished' && phase !== 'closed' && gameState?.finalJeopardy && myId && (
          <PlayerFinal gameState={gameState} myId={myId} />
        )}

        {/* Daily Double wager — only the assigned contestant sees this */}
        {phase !== 'join' && !gameState?.finalJeopardy && isDDWagering && gameState?.dailyDouble && (
          <DDPlayerWager dailyDouble={gameState.dailyDouble} />
        )}

      </main>

      {showBuzzer && (
        <>
          <section className="player-buzzer-station">
            {waitingForTeam && <p role="status" className="player-team-notice">Waiting for the host to assign you to a team.</p>}
            <div className="player-buzzer-identity">
              <p className="text-2xl font-black text-white break-words" title={displayName}>{displayName}</p>
              <p className="text-jeopardy-gold font-black text-2xl mt-2">{formatScore(myScore)}</p>
            </div>
            <div className="player-buzz-area">
              <button
                className={`player-buzz-button ${phase === 'open' ? '' : 'player-buzz-button--inactive'} ${phase === 'locked-out' || phase === 'incorrect' ? 'player-buzz-button--locked' : ''}`}
                style={{ touchAction: 'manipulation' }}
                disabled={!canBuzz}
                onClick={buzz}
                onTouchStart={event => { event.preventDefault(); buzz(); }}
              >
                {waitingForTeam ? 'Awaiting team' : buttonLabel}
              </button>
            </div>
          </section>
          <div className="player-buzzer-dock">
            {gameState && gameState.buzzerState !== 'open' && gameState.buzzedPlayerId === myId ? (
              <BuzzerStatus gameState={gameState} personal />
            ) : (phase === 'incorrect' || phase === 'locked-out' || phase === 'too-late') && (
              <div className="player-buzzer-message" role="status">
                <p className={`font-black text-xl ${phase === 'incorrect' || phase === 'locked-out' ? 'text-red-400' : 'text-gray-200'}`}>
                  {phase === 'incorrect' ? 'Incorrect answer' : phase === 'locked-out' ? 'Too early!' : 'Too slow!'}
                </p>
                <p className="text-gray-400 text-sm mt-2">
                  {phase === 'incorrect' ? 'Wait for the next question' : phase === 'too-late' ? `${winnerName} buzzed in first` : 'Wait for your buzzer to unlock'}
                </p>
              </div>
            )}
            {gameState && (
              <section className="player-scoreboard" aria-labelledby="player-scoreboard-title">
                <h2 id="player-scoreboard-title" className="text-gray-400 text-xs uppercase tracking-widest text-center">Scoreboard</h2>
                <div className="player-scoreboard__list" tabIndex={0} role="region" aria-label="Player scores">
                  {scoreboardRows}
                </div>
              </section>
            )}
          </div>
        </>
      )}

    </div>
  );
}
