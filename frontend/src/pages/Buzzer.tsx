import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket';
import { useGameStore } from '../store/gameStore';
import type { GameState } from '../types';
import PlayerFinal from '../components/final/PlayerFinal';
import DDPlayerWager from '../components/dailydouble/DDPlayerWager';

type BuzzerPhase = 'join' | 'lobby' | 'waiting' | 'armed' | 'open' | 'winner' | 'too-late' | 'locked-out';

function rejoinKey(roomCode: string | undefined) {
  return `jeopardy:player:${roomCode ?? ''}`;
}

export default function Buzzer() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const { gameState, setGameState, setMyPlayer } = useGameStore();
  const [phase, setPhase] = useState<BuzzerPhase>('join');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [winnerName, setWinnerName] = useState('');
  const [myId, setMyId] = useState('');

  // Try to rejoin (e.g. after a phone screen sleeps and drops the socket).
  useEffect(() => {
    if (!roomCode) return;
    function tryRejoin() {
      const savedId = localStorage.getItem(rejoinKey(roomCode));
      if (savedId) socket.emit('player:rejoin', { roomCode, playerId: savedId });
    }
    tryRejoin();
    socket.on('connect', tryRejoin);
    return () => { socket.off('connect', tryRejoin); };
  }, [roomCode]);

  useEffect(() => {
    socket.on('game:state', (state: GameState) => {
      setGameState(state);
      const transient = phase === 'winner' || phase === 'too-late' || phase === 'locked-out';
      if (!state.finalJeopardy && phase !== 'join' && phase !== 'lobby' && !transient) {
        if (state.buzzerState === 'open') setPhase('open');
        else if (state.activeQuestionId) setPhase('armed');
        else setPhase('waiting');
      }
    });
    socket.on('player:joined', ({ player, state }: { player: { id: string; name: string }; state: GameState }) => {
      setMyId(player.id);
      setMyPlayer(player as any);
      setGameState(state);
      setPhase('waiting');
      if (roomCode) localStorage.setItem(rejoinKey(roomCode), player.id);
    });
    socket.on('buzz:winner', ({ playerId, playerName }: { playerId: string; playerName: string }) => {
      if (playerId === myId) {
        setWinnerName(playerName);
        setPhase('winner');
      } else {
        setWinnerName(playerName);
        setPhase('too-late');
      }
      setTimeout(() => setPhase(prev => prev === 'winner' || prev === 'too-late' ? 'waiting' : prev), 5000);
    });
    socket.on('buzz:locked-out', ({ until }: { until: number }) => {
      setPhase('locked-out');
      const delay = Math.max(0, until - Date.now());
      setTimeout(() => setPhase(prev => prev === 'locked-out' ? 'armed' : prev), delay);
    });
    socket.on('buzzer:open', () => setPhase('open'));
    socket.on('buzzer:locked', () => setPhase(prev => prev === 'winner' || prev === 'too-late' || prev === 'locked-out' ? prev : 'waiting'));
    socket.on('error', ({ message }: { message: string }) => setError(message));
    return () => {
      socket.off('game:state');
      socket.off('player:joined');
      socket.off('buzz:winner');
      socket.off('buzz:locked-out');
      socket.off('buzzer:open');
      socket.off('buzzer:locked');
      socket.off('error');
    };
  }, [myId, phase]);

  function joinGame() {
    if (!name.trim()) { setError('Enter your name'); return; }
    setError('');
    socket.emit('player:join', { roomCode, name: name.trim(), color: randomColor() });
  }

  function buzz() {
    if (phase !== 'open' && phase !== 'armed') return;
    socket.emit('buzz');
    if (phase === 'open') setPhase('waiting');
  }

  const myScore = gameState?.players.find(p => p.id === myId)?.score ?? 0;
  const isDDWagering = !!(gameState?.dailyDouble && gameState.dailyDouble.playerId === myId
    && gameState.dailyDouble.stage === 'wagering' && gameState.dailyDouble.hasDevice);

  return (
    <div className="min-h-screen bg-jeopardy-dark flex flex-col items-center justify-center p-4 select-none">

      {/* Room code display */}
      <div className="text-gray-500 text-sm mb-6 text-center">
        Room: <span className="text-jeopardy-gold font-bold tracking-widest">{roomCode}</span>
      </div>

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

      {/* Final Jeopardy takes over once it starts */}
      {phase !== 'join' && gameState?.finalJeopardy && myId && (
        <PlayerFinal gameState={gameState} myId={myId} />
      )}

      {/* Daily Double wager — only the assigned contestant sees this */}
      {phase !== 'join' && !gameState?.finalJeopardy && isDDWagering && gameState?.dailyDouble && (
        <DDPlayerWager dailyDouble={gameState.dailyDouble} />
      )}

      {/* WAITING phase */}
      {!gameState?.finalJeopardy && !isDDWagering && phase === 'waiting' && (
        <div className="text-center">
          <p className="text-3xl font-black text-white mb-2">{name}</p>
          <p className="text-jeopardy-gold font-black text-2xl mb-8">
            {myScore < 0 ? `-$${Math.abs(myScore)}` : `$${myScore}`}
          </p>
          <div className="w-48 h-48 rounded-full bg-gray-800 border-8 border-gray-600 flex items-center justify-center mx-auto">
            <span className="text-gray-500 text-xl font-bold text-center px-4">Waiting...</span>
          </div>
        </div>
      )}

      {/* ARMED phase — question is active but buzzer isn't open yet; pressing still reaches the server */}
      {!gameState?.finalJeopardy && !isDDWagering && phase === 'armed' && (
        <div className="text-center">
          <p className="text-3xl font-black text-white mb-2">{name}</p>
          <p className="text-jeopardy-gold font-black text-2xl mb-8">
            {myScore < 0 ? `-$${Math.abs(myScore)}` : `$${myScore}`}
          </p>
          <button
            className="w-48 h-48 rounded-full bg-gray-800 border-8 border-gray-600 flex items-center justify-center mx-auto cursor-pointer"
            style={{ fontSize: '1.25rem', fontWeight: 900, color: '#6b7280', touchAction: 'manipulation' }}
            onClick={buzz}
            onTouchStart={e => { e.preventDefault(); buzz(); }}
          >
            Wait...
          </button>
          <p className="text-gray-500 font-bold mt-6">Get ready</p>
        </div>
      )}

      {/* LOCKED-OUT phase — pressed too early */}
      {!gameState?.finalJeopardy && phase === 'locked-out' && (
        <div className="text-center flip-in">
          <div className="w-48 h-48 rounded-full bg-red-900 border-8 border-red-500 flex items-center justify-center mx-auto animate-pulse">
            <span className="text-red-300 text-2xl font-black">Too early!</span>
          </div>
        </div>
      )}

      {/* OPEN phase — buzzer ready */}
      {!gameState?.finalJeopardy && !isDDWagering && phase === 'open' && (
        <div className="text-center">
          <p className="text-3xl font-black text-white mb-2">{name}</p>
          <p className="text-jeopardy-gold font-black text-2xl mb-8">
            {myScore < 0 ? `-$${Math.abs(myScore)}` : `$${myScore}`}
          </p>
          <button
            className="w-56 h-56 rounded-full border-8 border-jeopardy-gold bg-jeopardy-blue flex items-center justify-center mx-auto buzzer-active cursor-pointer"
            style={{ fontSize: '1.5rem', fontWeight: 900, color: '#FFD700', touchAction: 'manipulation' }}
            onClick={buzz}
            onTouchStart={e => { e.preventDefault(); buzz(); }}
          >
            BUZZ!
          </button>
          <p className="text-green-400 font-bold mt-6 animate-pulse">Buzzers are open!</p>
        </div>
      )}

      {/* WINNER phase */}
      {!gameState?.finalJeopardy && phase === 'winner' && (
        <div className="text-center flip-in">
          <div className="text-6xl mb-4">⚡</div>
          <h2 className="text-4xl font-black text-jeopardy-gold mb-2" style={{ textShadow: '2px 2px 0 #000' }}>
            YOU BUZZED IN!
          </h2>
          <p className="text-white text-xl">{name}</p>
        </div>
      )}

      {/* TOO LATE phase */}
      {!gameState?.finalJeopardy && phase === 'too-late' && (
        <div className="text-center flip-in">
          <div className="text-6xl mb-4">❌</div>
          <h2 className="text-3xl font-black text-red-400 mb-2">Too slow!</h2>
          <p className="text-gray-400">{winnerName} buzzed in first</p>
        </div>
      )}

      {/* Players list (compact) */}
      {!gameState?.finalJeopardy && gameState && gameState.players.length > 0 && phase !== 'join' && (
        <div className="mt-12 w-full max-w-sm">
          <h3 className="text-gray-500 text-xs uppercase tracking-widest mb-2 text-center">Scoreboard</h3>
          <div className="space-y-1">
            {[...gameState.players].sort((a, b) => b.score - a.score).map(p => (
              <div key={p.id} className="flex justify-between items-center px-3 py-1 rounded bg-gray-900">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                  <span className={`text-sm ${p.id === myId ? 'text-white font-bold' : 'text-gray-400'}`}>{p.name}</span>
                </div>
                <span className="font-bold text-sm" style={{ color: p.score < 0 ? '#ef4444' : '#FFD700' }}>
                  {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function randomColor() {
  const colors = ['#FFD700', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c', '#34d399', '#f472b6'];
  return colors[Math.floor(Math.random() * colors.length)];
}
