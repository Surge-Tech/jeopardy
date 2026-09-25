import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useGameStore } from '../store/gameStore';
import type { Board, GameState, Question } from '../types';
import { PERMANENT_LOCKOUT } from '../types';
import HostFinalPanel from '../components/final/HostFinalPanel';
import DDHostPanel from '../components/dailydouble/DDHostPanel';
import Leaderboard from '../components/shared/Leaderboard';
import { getRound, isRoundComplete } from '../utils/rounds';

const API = '/api';
const PLAYER_COLORS = ['#FFD700', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c', '#34d399', '#f472b6'];

const LOG_ICONS: Record<string, string> = {
  open: '📋', dd: '⭐', buzz: '⚡', correct: '✅', wrong: '❌', close: '✖', score: '💰',
  fj: '⚡', wager: '🎲', answer: '📝',
};
const LOG_COLORS: Record<string, string> = {
  open: 'text-blue-300', dd: 'text-yellow-300', buzz: 'text-orange-300',
  correct: 'text-green-400', wrong: 'text-red-400', close: 'text-gray-400', score: 'text-purple-300',
  fj: 'text-jeopardy-gold', wager: 'text-yellow-300', answer: 'text-blue-300',
};

export default function Host() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const { gameState, setGameState, roomCode, setRoomCode, gameLog, addLog, clearLog } = useGameStore();
  const [board, setBoard] = useState<Board | null>(null);
  const [activeQ, setActiveQ] = useState<Question | null>(null);
  const [addPlayerName, setAddPlayerName] = useState('');
  const [buzzWinner, setBuzzWinner] = useState<string | null>(null);
  const [buzzWinnerId, setBuzzWinnerId] = useState<string | null>(null);
  const [renamingPlayerId, setRenamingPlayerId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [tab, setTab] = useState<'players' | 'log' | 'stats'>('players');

  useEffect(() => {
    fetch(`${API}/boards/${boardId}`).then(r => r.json()).then(setBoard);

    socket.on('game:state', (state: GameState) => {
      setGameState(state);
      setRoomCode(state.roomCode);
    });
    socket.on('buzz:winner', ({ playerName, playerId }: { playerName: string; playerId: string }) => {
      setBuzzWinner(playerName);
      setBuzzWinnerId(playerId);
      addLog({ type: 'buzz', msg: `${playerName} buzzed in`, player: playerName });
    });
    socket.on('host:created', ({ roomCode: rc, state }: { roomCode: string; state: GameState }) => {
      setRoomCode(rc);
      setGameState(state);
      clearLog();
      addLog({ type: 'open', msg: 'Game session started' });
    });
    socket.on('fj:host-log', ({ msg }: { msg: string }) => {
      addLog({ type: 'fj', msg });
    });
    socket.on('buzz:next-in-queue', ({ playerName, playerId }: { playerName: string; playerId: string }) => {
      setBuzzWinner(playerName);
      setBuzzWinnerId(playerId);
      addLog({ type: 'buzz', msg: `Queue advance → ${playerName}`, player: playerName });
    });

    socket.emit('host:create', { boardId });

    return () => {
      socket.off('game:state');
      socket.off('buzz:winner');
      socket.off('host:created');
      socket.off('fj:host-log');
      socket.off('buzz:next-in-queue');
    };
  }, [boardId]);

  // Re-join the host:<roomCode> room after a socket reconnect (WiFi blip,
  // laptop sleep, backend restart) so host-only socket events keep working.
  useEffect(() => {
    function rejoinAsHost() {
      if (roomCode) socket.emit('host:join', { roomCode });
    }
    socket.on('connect', rejoinAsHost);
    return () => { socket.off('connect', rejoinAsHost); };
  }, [roomCode]);

  useEffect(() => {
    if (!gameState || !board) return;
    if (!gameState.activeQuestionId) { setActiveQ(null); return; }
    const round = getRound(board, gameState);
    const q = round.categories.flatMap(c => c.questions).find(q => q.id === gameState.activeQuestionId);
    setActiveQ(q ?? null);
  }, [gameState?.activeQuestionId, board, gameState?.currentRoundIndex]);

  if (!board || !gameState || !roomCode) {
    return <div className="flex items-center justify-center h-screen text-gray-400">Starting game session...</div>;
  }

  const answered = new Set(gameState.answeredQuestions);
  const round = getRound(board, gameState);
  const isLastRound = gameState.currentRoundIndex >= board.rounds.length - 1;
  const roundComplete = isRoundComplete(board, gameState.answeredQuestions, gameState.currentRoundIndex);

  function getCatName(q: Question): string {
    return round.categories.find(c => c.questions.some(cq => cq.id === q.id))?.name ?? '';
  }

  function openQuestion(q: Question) {
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    const boardHighValue = Math.max(...round.pointValues);
    socket.emit('host:open-question', { roomCode, questionId: q.id, isDailyDouble: !!q.isDailyDouble, boardHighValue });
    if (q.isDailyDouble) {
      addLog({ type: 'dd', msg: `Daily Double opened — $${q.value} (${getCatName(q)})` });
    } else {
      addLog({ type: 'open', msg: `Opened $${q.value} — ${getCatName(q)}` });
    }
  }

  function revealDD() {
    socket.emit('host:reveal-dd', { roomCode });
    addLog({ type: 'dd', msg: 'Daily Double clue revealed' });
  }

  function closeQuestion() {
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    const label = activeQ ? `$${activeQ.value} — ${getCatName(activeQ)}` : 'question';
    socket.emit('host:close-question', { roomCode });
    addLog({ type: 'close', msg: `Closed ${label} (no score)` });
  }

  function enableBuzzer() {
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    socket.emit('host:enable-buzzer', { roomCode });
  }

  function lockBuzzer() {
    socket.emit('host:lock-buzzer', { roomCode });
  }

  function resetBuzzer() {
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    socket.emit('host:reset-buzzer', { roomCode });
  }

  function showAnswer() {
    socket.emit('host:show-response', { roomCode });
  }

  function awardPoints(playerId: string, correct: boolean) {
    const isDD = !!activeQ?.isDailyDouble && gameState!.dailyDouble?.stage === 'ready';
    const value = isDD ? (gameState!.dailyDouble!.wager ?? 0) : (activeQ?.value ?? 0);
    const delta = correct ? value : -value;
    const player = gameState!.players.find(p => p.id === playerId);
    socket.emit('host:score', { roomCode, playerId, delta, outcome: correct ? 'correct' : 'wrong', isDailyDouble: isDD });
    if (correct) {
      addLog({ type: 'correct', msg: `${player?.name} answered correctly (+$${value})`, player: player?.name });
    } else {
      addLog({ type: 'wrong', msg: `${player?.name} answered wrong (-$${value})`, player: player?.name });
    }
    // close without double-logging
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    socket.emit('host:close-question', { roomCode });
  }

  function markWrongAndReopen(playerId: string) {
    const value = activeQ?.value ?? 0;
    const player = gameState!.players.find(p => p.id === playerId);
    socket.emit('host:wrong-reopen', { roomCode, playerId, delta: -value });
    addLog({ type: 'wrong', msg: `${player?.name ?? 'Player'} answered wrong (-$${value})`, player: player?.name });
    setBuzzWinner(null);
    setBuzzWinnerId(null);
  }

  function adjustScore(playerId: string, delta: number) {
    const player = gameState!.players.find(p => p.id === playerId);
    socket.emit('host:score', { roomCode, playerId, delta });
    addLog({ type: 'score', msg: `${player?.name} score adjusted ${delta > 0 ? '+' : ''}${delta}`, player: player?.name });
  }

  function addPlayer() {
    if (!addPlayerName.trim()) return;
    const color = PLAYER_COLORS[(gameState?.players.length ?? 0) % PLAYER_COLORS.length];
    socket.emit('host:add-player', { roomCode, name: addPlayerName.trim(), color });
    setAddPlayerName('');
  }

  function removePlayer(playerId: string) {
    socket.emit('host:remove-player', { roomCode, playerId });
  }

  function startRenamePlayer(player: { id: string; name: string }) {
    setRenamingPlayerId(player.id);
    setRenameValue(player.name);
    setRenameError('');
  }

  function cancelRenamePlayer() {
    setRenamingPlayerId(null);
    setRenameError('');
  }

  function saveRenamePlayer(playerId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { setRenameError('Name cannot be empty'); return; }
    socket.emit('host:rename-player', { roomCode, playerId, newName: trimmed }, (res: { ok: boolean; error?: string }) => {
      if (res.ok) {
        setRenamingPlayerId(null);
        setRenameError('');
      } else {
        setRenameError(res.error ?? 'Could not rename');
      }
    });
  }

  function startFinalJeopardy() {
    const totalQuestions = board!.rounds.reduce((n, r) => n + r.categories.reduce((n2, c) => n2 + c.questions.length, 0), 0);
    const remaining = totalQuestions - gameState!.answeredQuestions.length;
    if (remaining > 0 && !confirm(`${remaining} clue(s) haven't been played yet. Start Final Jeopardy anyway?`)) return;
    socket.emit('host:fj-start', { roomCode });
  }

  function nextRound() {
    socket.emit('host:next-round', { roomCode });
  }

  function endGame() {
    if (!confirm('End the game and show the leaderboard?')) return;
    socket.emit('host:end-game', { roomCode });
  }

  function resumeGame() {
    socket.emit('host:resume-game', { roomCode });
  }

  function closeRoom() {
    if (!confirm('Close this room? This ends the session for everyone and cannot be undone.')) return;
    socket.emit('host:end', { roomCode });
    navigate('/');
  }
  const boardUrl = `${window.location.origin}/board/${roomCode}`;
  const buzzUrl = `${window.location.origin}/buzz/${roomCode}`;

  // Per-player stats come from the server (survives refresh, includes early buzzes)
  const playerStats = gameState.players.map(p => ({
    ...p,
    correct: p.stats?.correct ?? 0,
    wrong: p.stats?.wrong ?? 0,
    buzzes: p.stats?.buzzes ?? 0,
    earlyBuzzes: p.stats?.earlyBuzzes ?? 0,
  })).sort((a, b) => b.score - a.score);

  function setLockout(ms: number) {
    socket.emit('host:set-lockout', { roomCode, ms });
  }

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col text-white">
      {/* Header */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 py-3 flex items-center gap-4 flex-wrap">
        <button onClick={closeRoom} className="text-gray-400 hover:text-white text-sm">Close Room</button>
        <h1 className="text-xl font-black text-jeopardy-gold">{board.name}</h1>
        <div className="bg-gray-800 rounded px-3 py-1 text-sm">
          Round {gameState.currentRoundIndex + 1} of {board.rounds.length}
          {round.name ? ` — ${round.name}` : ''}
        </div>
        <div className="ml-auto flex gap-3 items-center flex-wrap">
          {!isLastRound && (
            <button
              className={`text-sm py-1 px-3 rounded font-bold ${roundComplete ? 'bg-jeopardy-gold text-jeopardy-dark' : 'btn-ghost'}`}
              disabled={!!gameState.activeQuestionId}
              onClick={nextRound}
            >
              Next Round →
            </button>
          )}
          <div className="bg-gray-800 rounded px-3 py-1 text-sm">
            Room: <span className="text-jeopardy-gold font-black tracking-widest text-lg">{roomCode}</span>
          </div>
          <a href={boardUrl} target="_blank" rel="noopener" className="btn-ghost text-sm py-1 px-3">📺 Board View</a>
          <div className="bg-gray-800 rounded px-3 py-1 text-sm flex items-center gap-2">
            <span className="text-gray-400">Lockout:</span>
            <select
              className="bg-gray-800 text-white text-sm"
              value={gameState.settings.lockoutMs}
              onChange={e => setLockout(Number(e.target.value))}
            >
              <option value={0}>Off</option>
              <option value={250}>250ms</option>
              <option value={500}>500ms</option>
              <option value={1000}>1000ms</option>
            </select>
          </div>
          <div className="flex items-center gap-2 bg-gray-800 rounded px-3 py-1 text-sm">
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={gameState.settings.autoLockEnabled}
                onChange={e => socket.emit('host:set-auto-lock', { roomCode, enabled: e.target.checked })}
                className="accent-yellow-400"
              />
              <span className="text-gray-400 text-xs">Auto-lock</span>
            </label>
            {gameState.settings.autoLockEnabled && (
              <>
                <input
                  type="number"
                  min={5}
                  max={10}
                  value={gameState.settings.autoLockTimeoutS}
                  onChange={e => {
                    const s = Number(e.target.value);
                    if (s >= 5 && s <= 10) socket.emit('host:set-auto-lock-timeout', { roomCode, seconds: s });
                  }}
                  className="bg-gray-700 text-white text-xs w-10 rounded px-1 py-0.5 text-center"
                />
                <span className="text-gray-400 text-xs">s</span>
              </>
            )}
          </div>
          {gameState.phase !== 'finished' && (
            <button className="btn-danger text-sm py-1 px-3" onClick={endGame}>End Game</button>
          )}
        </div>
      </div>

      {/* Game-over banner */}
      {gameState.phase === 'finished' && (
        <div className="bg-jeopardy-gold text-jeopardy-dark px-4 py-2 flex items-center gap-4 flex-wrap font-bold">
          <span>🏁 Game ended</span>
          <div className="ml-auto flex gap-2">
            <button className="bg-jeopardy-dark text-white text-sm py-1 px-3 rounded" onClick={resumeGame}>Resume</button>
            <button className="bg-red-700 text-white text-sm py-1 px-3 rounded" onClick={closeRoom}>Close Room</button>
          </div>
        </div>
      )}

      {/* Prompt when the last round is complete and the board has Final Jeopardy */}
      {gameState.phase !== 'finished' && isLastRound && roundComplete && !gameState.activeQuestionId && board.finalJeopardy && !gameState.finalJeopardy && (
        <div className="bg-jeopardy-blue px-4 py-2 flex items-center gap-4 flex-wrap font-bold text-white">
          <span>⚡ Last round complete — start Final Jeopardy or end the game.</span>
          <div className="ml-auto flex gap-2">
            <button className="bg-jeopardy-gold text-jeopardy-dark text-sm py-1 px-3 rounded" onClick={startFinalJeopardy}>Start Final Jeopardy</button>
            <button className="bg-red-700 text-white text-sm py-1 px-3 rounded" onClick={endGame}>End Game</button>
          </div>
        </div>
      )}

      {gameState.phase === 'finished' ? (
        <div className="flex-1 overflow-auto p-8">
          <Leaderboard gameState={gameState} />
        </div>
      ) : (
      <div className="flex-1 flex gap-0 overflow-hidden">
        {/* Left: Board grid */}
        <div className="flex-1 overflow-auto p-3">
          <div className="overflow-x-auto">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${round.categories.length}, minmax(110px, 1fr))` }}
            >
              {/* Category headers */}
              {round.categories.map(cat => (
                <div key={cat.id} className="bg-jeopardy-blue border-2 border-black text-jeopardy-gold font-black text-center p-2 text-xs uppercase">
                  {cat.name || 'CATEGORY'}
                </div>
              ))}
              {/* Question cells */}
              {round.pointValues.map(pv =>
                round.categories.map(cat => {
                  const q = cat.questions.find(q => q.value === pv);
                  if (!q) return <div key={`${cat.id}-${pv}`} />;
                  const isAnswered = answered.has(q.id);
                  const isActive = gameState.activeQuestionId === q.id;
                  return (
                    <button
                      key={q.id}
                      disabled={isAnswered}
                      onClick={() => !isAnswered && openQuestion(q)}
                      className={`relative border-2 border-black text-center font-black py-3 text-sm transition-all
                        ${isActive ? 'bg-yellow-500 text-black border-yellow-300' :
                          isAnswered ? 'bg-gray-900 text-gray-700 cursor-not-allowed' :
                          'bg-jeopardy-blue text-jeopardy-gold hover:brightness-125'}`}
                    >
                      {isAnswered ? '—' : `$${pv}`}
                      {q.isDailyDouble && !isAnswered && (
                        <span className="absolute top-1 right-1 bg-yellow-400 text-black text-[9px] font-black px-1 rounded leading-tight">DD</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Final Jeopardy launcher */}
          {board.finalJeopardy && !gameState.finalJeopardy && (
            <button
              className="mt-4 w-full bg-jeopardy-gold text-jeopardy-dark font-black py-3 rounded-lg hover:brightness-110 transition-all"
              onClick={startFinalJeopardy}
            >
              ⚡ Start Final Jeopardy
            </button>
          )}

          {/* Share links */}
          <div className="mt-4 space-y-2">
            <ShareLink label="Board view (project this)" url={boardUrl} />
            <ShareLink label="Player buzzer (share with players)" url={buzzUrl} />
          </div>
        </div>

        {/* Right panel */}
        <div className="w-80 bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">

          {/* Active question panel */}
          <div className="p-4 border-b border-gray-700 flex-shrink-0">
            <h2 className="text-sm font-bold text-gray-400 uppercase mb-3">Active Question</h2>
            {gameState.finalJeopardy ? (
              <HostFinalPanel roomCode={roomCode} gameState={gameState} board={board} />
            ) : activeQ?.isDailyDouble && gameState.dailyDouble ? (
              <DDHostPanel
                roomCode={roomCode}
                gameState={gameState}
                activeQ={activeQ}
                onAward={awardPoints}
                onReveal={revealDD}
                onClose={closeQuestion}
              />
            ) : activeQ ? (
              <div className="space-y-3">
                <div className="text-jeopardy-gold font-black text-xl">${activeQ.value}</div>

                <div className="bg-gray-800 rounded p-3 text-sm text-white leading-relaxed">{activeQ.clue}</div>

                {/* Answer always visible to host */}
                <div className="bg-green-950 border border-green-700 rounded p-3 text-sm text-green-300">
                  <div className="text-[10px] text-gray-500 uppercase mb-1">Answer</div>
                  {activeQ.response}
                </div>

                {/* Show on board button — only relevant until revealed */}
                {!gameState.responseVisible && (
                  <button className="btn-ghost text-sm w-full" onClick={showAnswer}>Show Answer on Board</button>
                )}

                {/* Buzzer controls */}
                <div className="space-y-2">
                  {gameState.buzzerState === 'idle' && (
                    <button className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded transition-colors" onClick={enableBuzzer}>
                      🔔 Open Buzzers
                    </button>
                  )}
                  {gameState.buzzerState === 'open' && (
                    <button className="w-full bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 rounded transition-colors" onClick={lockBuzzer}>
                      🔒 Lock Buzzers
                    </button>
                  )}
                  {gameState.buzzerState === 'locked' && buzzWinner && (
                    <div className="bg-jeopardy-blue border-2 border-jeopardy-gold rounded p-3 text-center">
                      <div className="text-gray-300 text-sm">Buzzed In:</div>
                      <div className="text-jeopardy-gold font-black text-lg">{buzzWinner}</div>
                      <div className="flex gap-2 mt-2">
                        <button
                          className="flex-1 bg-green-600 hover:bg-green-500 text-white font-bold py-1 rounded text-sm"
                          onClick={() => {
                            if (buzzWinnerId) awardPoints(buzzWinnerId, true);
                          }}
                        >✓ Correct</button>
                        <button
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white font-bold py-1 rounded text-sm"
                          onClick={() => {
                            if (buzzWinnerId) markWrongAndReopen(buzzWinnerId);
                          }}
                        >✗ Wrong</button>
                        <button className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-1 px-2 rounded text-sm" onClick={resetBuzzer}>↺</button>
                      </div>
                    </div>
                  )}
                  {gameState.buzzerState === 'locked' && !buzzWinner && (
                    <button className="w-full bg-green-600 hover:bg-green-500 text-white font-bold py-2 rounded transition-colors" onClick={resetBuzzer}>
                      🔔 Re-open Buzzers
                    </button>
                  )}
                </div>

                {(() => {
                  const lockedOut = gameState.players.filter(
                    p => gameState.buzzLockouts[p.id] === PERMANENT_LOCKOUT
                  );
                  if (lockedOut.length === 0) return null;
                  return (
                    <div className="mt-2">
                      <div className="text-[10px] text-gray-500 uppercase mb-1">Ineligible this question</div>
                      <div className="flex flex-wrap gap-1">
                        {lockedOut.map(p => (
                          <span key={p.id} className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">
                            {p.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {gameState.buzzQueue && gameState.buzzQueue.length > 0 && (
                  <div className="mt-2">
                    <div className="text-[10px] text-gray-500 uppercase mb-1">Buzz Queue</div>
                    <div className="space-y-1">
                      {gameState.buzzQueue.map((entry, i) => (
                        <div
                          key={entry.playerId}
                          className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${
                            entry.attemptedAnswer
                              ? 'bg-gray-800 text-gray-500 line-through'
                              : gameState.buzzedPlayerId === entry.playerId
                              ? 'bg-blue-900 text-white font-bold'
                              : 'bg-gray-800 text-gray-300'
                          }`}
                        >
                          <span className="text-gray-500 w-4">{i + 1}.</span>
                          <span className="flex-1">{entry.playerName}</span>
                          <span className="text-gray-500 tabular-nums">{entry.reactionMs}ms</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button className="btn-danger text-sm w-full" onClick={closeQuestion}>Close Question</button>
              </div>
            ) : (
              <p className="text-gray-500 text-sm">Click a question on the board to open it.</p>
            )}
          </div>

          {/* Tab bar */}
          <div className="flex border-b border-gray-700 flex-shrink-0">
            {(['players', 'log', 'stats'] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-xs font-bold uppercase transition-colors
                  ${tab === t ? 'text-jeopardy-gold border-b-2 border-jeopardy-gold bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}
              >
                {t === 'players' ? '👥 Players' : t === 'log' ? '📜 Log' : '📊 Stats'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-4">

            {/* Players tab */}
            {tab === 'players' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    className="input-field text-sm flex-1"
                    placeholder="Player name..."
                    value={addPlayerName}
                    onChange={e => setAddPlayerName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addPlayer()}
                  />
                  <button className="btn-primary text-sm py-1 px-3" onClick={addPlayer}>+</button>
                </div>
                {gameState.players.length === 0 && (
                  <p className="text-gray-600 text-sm">No players. Add some above or share the buzzer URL.</p>
                )}
                {gameState.players.map(player => (
                  <div key={player.id} className="bg-gray-800 rounded-lg p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: player.color }} />
                      <div className="flex-1 min-w-0">
                        {renamingPlayerId === player.id ? (
                          <div className="flex flex-col gap-1">
                            <div className="flex gap-1">
                              <input
                                autoFocus
                                className="input-field text-xs flex-1 py-1"
                                value={renameValue}
                                onChange={e => setRenameValue(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') saveRenamePlayer(player.id); if (e.key === 'Escape') cancelRenamePlayer(); }}
                                maxLength={40}
                              />
                              <button className="text-xs bg-jeopardy-gold text-jeopardy-dark font-bold px-2 py-1 rounded" onClick={() => saveRenamePlayer(player.id)}>Save</button>
                              <button className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" onClick={cancelRenamePlayer}>✕</button>
                            </div>
                            {renameError && <p className="text-red-400 text-xs">{renameError}</p>}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1">
                            <span className="font-bold text-sm truncate">{player.name}</span>
                            <button
                              className="text-gray-500 hover:text-gray-300 text-xs flex-shrink-0"
                              title="Rename player"
                              onClick={() => startRenamePlayer(player)}
                            >✎</button>
                          </div>
                        )}
                        <div className="font-black" style={{ color: player.score < 0 ? '#ef4444' : '#FFD700' }}>
                          {player.score < 0 ? `-$${Math.abs(player.score)}` : `$${player.score}`}
                        </div>
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" onClick={() => adjustScore(player.id, 100)}>+100</button>
                        <button className="text-xs bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded" onClick={() => adjustScore(player.id, -100)}>-100</button>
                        <button className="text-xs text-red-400 hover:text-red-200 px-1" onClick={() => removePlayer(player.id)}>✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Log tab */}
            {tab === 'log' && (
              <div className="space-y-1">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs text-gray-500">{gameLog.length} events</span>
                  <button className="text-xs text-gray-500 hover:text-red-400" onClick={clearLog}>Clear</button>
                </div>
                {gameLog.length === 0 && <p className="text-gray-600 text-sm">No events yet.</p>}
                {gameLog.map(entry => (
                  <div key={entry.id} className="flex gap-2 text-xs py-1 border-b border-gray-800">
                    <span className="text-gray-600 flex-shrink-0 tabular-nums">{entry.ts}</span>
                    <span className="flex-shrink-0">{LOG_ICONS[entry.type]}</span>
                    <span className={LOG_COLORS[entry.type]}>{entry.msg}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Stats tab */}
            {tab === 'stats' && (
              <div className="space-y-4">
                {gameState.players.length === 0 && <p className="text-gray-600 text-sm">No players yet.</p>}

                {/* Leaderboard */}
                {playerStats.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase mb-2">Leaderboard</div>
                    {playerStats.map((p, i) => (
                      <div key={p.id} className="flex items-center gap-2 py-2 border-b border-gray-800">
                        <span className="text-gray-500 text-xs w-4 text-right">{i + 1}</span>
                        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
                        <span className="flex-1 text-sm font-bold truncate">{p.name}</span>
                        <span className="font-black text-sm" style={{ color: p.score < 0 ? '#ef4444' : '#FFD700' }}>
                          {p.score < 0 ? `-$${Math.abs(p.score)}` : `$${p.score}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Per-player breakdown */}
                {playerStats.length > 0 && (
                  <div>
                    <div className="text-xs font-bold text-gray-400 uppercase mb-2">Answer Breakdown</div>
                    <div className="space-y-2">
                      {playerStats.map(p => (
                        <div key={p.id} className="bg-gray-800 rounded p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
                            <span className="font-bold text-sm">{p.name}</span>
                          </div>
                          <div className="grid grid-cols-4 gap-1 text-center text-xs">
                            <div className="bg-gray-700 rounded py-1">
                              <div className="text-green-400 font-black text-base">{p.correct}</div>
                              <div className="text-gray-400">Correct</div>
                            </div>
                            <div className="bg-gray-700 rounded py-1">
                              <div className="text-red-400 font-black text-base">{p.wrong}</div>
                              <div className="text-gray-400">Wrong</div>
                            </div>
                            <div className="bg-gray-700 rounded py-1">
                              <div className="text-orange-300 font-black text-base">{p.buzzes}</div>
                              <div className="text-gray-400">Buzzes</div>
                            </div>
                            <div className="bg-gray-700 rounded py-1">
                              <div className="text-red-300 font-black text-base">{p.earlyBuzzes}</div>
                              <div className="text-gray-400">Early</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Game summary */}
                <div>
                  <div className="text-xs font-bold text-gray-400 uppercase mb-2">Game Summary</div>
                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                    <div className="bg-gray-800 rounded p-2">
                      <div className="text-white font-black text-base">{gameState.answeredQuestions.length}</div>
                      <div className="text-gray-400">Questions Closed</div>
                    </div>
                    <div className="bg-gray-800 rounded p-2">
                      <div className="text-white font-black text-base">{gameLog.filter(e => e.type === 'correct').length}</div>
                      <div className="text-gray-400">Correct Answers</div>
                    </div>
                    <div className="bg-gray-800 rounded p-2">
                      <div className="text-white font-black text-base">{gameLog.filter(e => e.type === 'wrong').length}</div>
                      <div className="text-gray-400">Wrong Answers</div>
                    </div>
                    <div className="bg-gray-800 rounded p-2">
                      <div className="text-white font-black text-base">{gameLog.filter(e => e.type === 'dd').length}</div>
                      <div className="text-gray-400">Daily Doubles</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function ShareLink({ label, url }: { label: string; url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="bg-gray-800 rounded p-2 flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-gray-400">{label}</div>
        <div className="text-xs text-gray-300 truncate font-mono">{url}</div>
      </div>
      <button className="text-xs btn-ghost py-1 px-2 flex-shrink-0" onClick={copy}>
        {copied ? '✓' : 'Copy'}
      </button>
    </div>
  );
}
