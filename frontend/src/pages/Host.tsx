import BoardMediaControls from '../components/host/BoardMediaControls';
import TeamsPanel from '../components/host/TeamsPanel';
import LobbyBuzzerTest from '../components/shared/LobbyBuzzerTest';
import LobbySpeakerTest from '../components/shared/LobbySpeakerTest';
import { getCompetitor, playerLabel } from '@shared/competitors';
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { socket } from '../socket';
import { useGameStore } from '../store/gameStore';
import type { Board, GameState, Question } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import HostFinalPanel from '../components/final/HostFinalPanel';
import DDHostPanel from '../components/dailydouble/DDHostPanel';
import Leaderboard from '../components/shared/Leaderboard';
import { getRound, isRoundComplete } from '../utils/rounds';
import { PLAYER_COLORS } from '../utils/colors';
import { hasPendingAnswer } from '@shared/questionFlow';
import { getQuestionShortcut } from '../utils/questionShortcuts';
import ShareLink from '../components/host/ShareLink';
import BoardGrid from '../components/host/BoardGrid';
import ActiveQuestionPanel from '../components/host/ActiveQuestionPanel';
import QuestionCountdown from '../components/host/QuestionCountdown';
import BuzzerStatus from '../components/shared/BuzzerStatus';
import AnswerTimeSetting from '../components/host/AnswerTimeSetting';
import PlayersTab from '../components/host/PlayersTab';
import LogTab from '../components/host/LogTab';
import StatsTab from '../components/host/StatsTab';
import { getHostRoom, saveHostRoom, clearHostRoom } from '../lib/hostRoom';

const API = '/api';

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
  const [hostError, setHostError] = useState('');
  const [sessionNotice, setSessionNotice] = useState('');
  const [tab, setTab] = useState<'players' | 'log' | 'stats'>('players');

  useEffect(() => {
    fetch(`${API}/boards/${boardId}`).then(r => r.json()).then(setBoard);
    let savedRoom = getHostRoom(boardId!);

    function startSession() {
      socket.emit(SOCKET_EVENTS.HOST_CREATE, { boardId, roomCode: savedRoom ?? undefined });
    }

    socket.on('error', ({ message }: { message: string }) => setHostError(message));
    socket.on(SOCKET_EVENTS.GAME_STATE, (state: GameState) => {
      setGameState(state);
      setHostError('');
      setRoomCode(state.roomCode);
    });
    socket.on(SOCKET_EVENTS.BUZZ_WINNER, ({ playerName, playerId }: { playerName: string; playerId: string }) => {
      setBuzzWinner(playerName);
      setBuzzWinnerId(playerId);
      addLog({ type: 'buzz', msg: `${playerName} buzzed in`, player: playerName });
    });
    socket.on(SOCKET_EVENTS.HOST_CREATED, ({ roomCode: rc, state, resumed }: { roomCode: string; state: GameState; resumed?: boolean }) => {
      setSessionNotice(savedRoom && !resumed ? 'The previous room is no longer available. A new game has been started.' : '');
      savedRoom = rc;
      saveHostRoom(boardId!, rc);
      setRoomCode(rc);
      setGameState(state);
      setBuzzWinner(state.buzzedPlayerName);
      setBuzzWinnerId(state.buzzedPlayerId);
      if (!resumed) {
        clearLog();
        addLog({ type: 'open', msg: 'Game session started' });
      }
    });
    socket.on(SOCKET_EVENTS.FJ_HOST_LOG, ({ msg }: { msg: string }) => {
      addLog({ type: 'fj', msg });
    });
    socket.on('connect', startSession);
    // Defer until after React's StrictMode effect cleanup/replay so a fresh
    // mount on an already-connected socket creates only one room.
    let disposed = false;
    if (socket.connected) queueMicrotask(() => { if (!disposed) startSession(); });

    return () => {
      disposed = true;
      socket.off('error');
      socket.off('connect', startSession);
      socket.off('game:state');
      socket.off('buzz:winner');
      socket.off('host:created');
      socket.off('fj:host-log');
    };
  }, [boardId]);

  useEffect(() => {
    if (!gameState || !board) return;
    if (!gameState.activeQuestionId) { setActiveQ(null); return; }
    const round = getRound(board, gameState);
    const q = round.categories.flatMap(c => c.questions).find(q => q.id === gameState.activeQuestionId);
    setActiveQ(q ?? null);
  }, [gameState?.activeQuestionId, board, gameState?.currentRoundIndex]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!gameState?.activeQuestionId || gameState.phase === 'finished' || gameState.finalJeopardy || !activeQ) return;
      if (activeQ.isDailyDouble) {
        if (!gameState.dailyDouble && (event.code === 'Space' || event.key === ' ')) {
          event.preventDefault();
          activateDD();
        }
        return;
      }
      const action = getQuestionShortcut(event, gameState);
      if (!action) return;
      event.preventDefault();
      if (action === 'reveal') revealClue();
      else if (action === 'open') enableBuzzer();
      else if (action === 'response') showAnswer();
      else if (action === 'close') closeQuestion();
      else if (action === 'correct' && gameState.buzzedPlayerId) awardPoints(gameState.buzzedPlayerId, true);
      else if (action === 'wrong' && gameState.buzzedPlayerId) markWrongAndReopen(gameState.buzzedPlayerId);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [gameState, activeQ, roomCode]);

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
    if (gameState && (hasPendingAnswer(gameState) || gameState.dailyDouble)) return;
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    socket.emit(SOCKET_EVENTS.HOST_OPEN_QUESTION, { roomCode, questionId: q.id, isDailyDouble: !!q.isDailyDouble });
    if (q.isDailyDouble) {
      addLog({ type: 'dd', msg: `Daily Double selected — ${q.value} (${getCatName(q)})` });
    } else {
      addLog({ type: 'open', msg: `Opened ${q.value} — ${getCatName(q)}` });
    }
  }

  function activateDD() {
    socket.emit(SOCKET_EVENTS.HOST_ACTIVATE_DD, { roomCode, boardHighValue: Math.max(...round.pointValues) });
    addLog({ type: 'dd', msg: 'Daily Double activated' });
  }

  function revealDD() {
    socket.emit(SOCKET_EVENTS.HOST_REVEAL_DD, { roomCode });
    addLog({ type: 'dd', msg: 'Daily Double clue revealed' });
  }

  function closeQuestion() {
    if (gameState && hasPendingAnswer(gameState)) return;
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    const label = activeQ ? `${activeQ.value} — ${getCatName(activeQ)}` : 'question';
    socket.emit(SOCKET_EVENTS.HOST_CLOSE_QUESTION, { roomCode });
    addLog({ type: 'close', msg: `Closed ${label}` });
  }

  function revealClue() {
    socket.emit(SOCKET_EVENTS.HOST_REVEAL_CLUE, { roomCode });
  }

  function enableBuzzer() {
    if (gameState && hasPendingAnswer(gameState)) return;
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    socket.emit(SOCKET_EVENTS.HOST_ENABLE_BUZZER, { roomCode });
  }

  function lockBuzzer() {
    socket.emit(SOCKET_EVENTS.HOST_LOCK_BUZZER, { roomCode });
  }

  function resetBuzzer() {
    setBuzzWinner(null);
    setBuzzWinnerId(null);
    socket.emit(SOCKET_EVENTS.HOST_RESET_BUZZER, { roomCode });
  }

  function showAnswer() {
    socket.emit(SOCKET_EVENTS.HOST_SHOW_RESPONSE, { roomCode });
  }

  function awardPoints(playerId: string, correct: boolean) {
    const isDD = !!activeQ?.isDailyDouble && gameState!.dailyDouble?.stage === 'ready';
    const value = isDD ? (gameState!.dailyDouble!.wager ?? 0) : (activeQ?.value ?? 0);
    const delta = correct ? value : -value;
    const player = getCompetitor(gameState!, playerId);
    socket.emit(SOCKET_EVENTS.HOST_SCORE, { roomCode, playerId, delta, outcome: correct ? 'correct' : 'wrong', isDailyDouble: isDD });
    if (correct) {
      addLog({ type: 'correct', msg: `${player?.name} answered correctly (+${value})`, player: player?.name });
    } else {
      addLog({ type: 'wrong', msg: `${player?.name} answered wrong (-${value})`, player: player?.name });
    }
    // Keep both Daily Double outcomes open for answer reveal and an explicit close.
  }

  function markWrongAndReopen(playerId: string) {
    const value = activeQ?.value ?? 0;
    const player = getCompetitor(gameState!, playerId);
    socket.emit(SOCKET_EVENTS.HOST_WRONG_REOPEN, { roomCode, playerId, delta: -value });
    addLog({ type: 'wrong', msg: `${player?.name ?? 'Player'} answered wrong (-${value})`, player: player?.name });
    setBuzzWinner(null);
    setBuzzWinnerId(null);
  }

  function adjustScore(playerId: string, delta: number) {
    const player = getCompetitor(gameState!, playerId);
    socket.emit(SOCKET_EVENTS.HOST_SCORE, { roomCode, playerId, delta });
    addLog({ type: 'score', msg: `${player?.name} score adjusted ${delta > 0 ? '+' : ''}${delta}`, player: player?.name });
  }

  function addPlayer() {
    if (!addPlayerName.trim()) return;
    const color = PLAYER_COLORS[(gameState?.players.length ?? 0) % PLAYER_COLORS.length];
    socket.emit(SOCKET_EVENTS.HOST_ADD_PLAYER, { roomCode, name: addPlayerName.trim(), color });
    setAddPlayerName('');
  }

  function removePlayer(playerId: string) {
    socket.emit(SOCKET_EVENTS.HOST_REMOVE_PLAYER, { roomCode, playerId });
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
    socket.emit(SOCKET_EVENTS.HOST_RENAME_PLAYER, { roomCode, playerId, newName: trimmed }, (res: { ok: boolean; error?: string }) => {
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
    socket.emit(SOCKET_EVENTS.HOST_FJ_START, { roomCode });
  }

  function nextRound() {
    socket.emit(SOCKET_EVENTS.HOST_NEXT_ROUND, { roomCode });
  }

  function endGame() {
    if (!confirm('End the game and show the leaderboard?')) return;
    socket.emit(SOCKET_EVENTS.HOST_END_GAME, { roomCode });
  }

  function resumeGame() {
    socket.emit(SOCKET_EVENTS.HOST_RESUME_GAME, { roomCode });
  }

  function closeRoom() {
    if (!confirm('Close this room? This ends the session for everyone and cannot be undone.')) return;
    clearHostRoom(boardId!);
    socket.emit(SOCKET_EVENTS.HOST_END, { roomCode });
    navigate('/');
  }
  const boardUrl = `${window.location.origin}/board/${roomCode}`;
  const buzzUrl = `${window.location.origin}/buzz/${roomCode}`;
  const qrUrl = `${window.location.origin}/qr/${roomCode}`;

  // Per-player stats come from the server (survives refresh, includes early buzzes)
  const playerStats = gameState.players.map(p => ({
    ...p,
    name: playerLabel(gameState, p.id),
    score: getCompetitor(gameState, p.id)?.score ?? 0,
    correct: p.stats?.correct ?? 0,
    wrong: p.stats?.wrong ?? 0,
    buzzes: p.stats?.buzzes ?? 0,
    earlyBuzzes: p.stats?.earlyBuzzes ?? 0,
  })).sort((a, b) => b.score - a.score);

  function setLockout(ms: number) {
    socket.emit(SOCKET_EVENTS.HOST_SET_LOCKOUT, { roomCode, ms });
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
          {gameState.phase === 'playing' && !isLastRound && (
            <button
              className={`text-sm py-1 px-3 rounded font-bold ${roundComplete ? 'bg-jeopardy-gold text-jeopardy-dark' : 'btn-ghost'}`}
              disabled={!!gameState.activeQuestionId}
              onClick={nextRound}
            >
              Next Round →
            </button>
          )}
          {gameState.phase === 'playing' && board.finalJeopardy && !gameState.finalJeopardy && (
            <button
              className="bg-jeopardy-gold text-jeopardy-dark text-sm py-1 px-3 rounded font-bold hover:brightness-110 transition-all"
              onClick={startFinalJeopardy}
            >
              ⚡ Start Final Jeopardy
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
          <AnswerTimeSetting seconds={gameState.settings.answerTimeS ?? 10}
            onChange={seconds => socket.emit(SOCKET_EVENTS.HOST_SET_ANSWER_TIME, { roomCode, seconds })} />
          <AnswerTimeSetting label="Daily Double time" max={300} seconds={gameState.settings.dailyDoubleTimeS ?? 15}
            onChange={seconds => socket.emit(SOCKET_EVENTS.HOST_SET_DD_TIME, { roomCode, seconds })} />
          {gameState.phase === 'playing' && (
            <button className="btn-danger text-sm py-1 px-3" onClick={endGame}>End Game</button>
          )}
        </div>
      </div>

      {hostError && <p role="alert" className="bg-red-950 text-red-300 px-4 py-2">{hostError}</p>}
      {sessionNotice && <p role="status" className="bg-gray-900 text-jeopardy-gold px-4 py-2">{sessionNotice}</p>}
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
      {gameState.phase === 'playing' && isLastRound && roundComplete && !gameState.activeQuestionId && board.finalJeopardy && !gameState.finalJeopardy && (
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
      <div className="flex-1 flex flex-col lg:flex-row gap-0 overflow-hidden">
        {/* Left: Board grid */}
        <div className="flex-1 min-w-0 overflow-auto p-3">
          {gameState.phase === 'lobby' ? (
            <section className="mx-auto max-w-2xl space-y-6 p-3" aria-label="Lobby setup">
              <div><h2 className="text-3xl font-black text-jeopardy-gold">Game lobby</h2>
                <p className="text-gray-300 mt-2">Choose a mode, let players join, then press Start game. The board view displays the QR code and live roster.</p></div>
              <TeamsPanel gameState={gameState} roomCode={roomCode} />
            </section>
          ) : <BoardGrid
            round={round}
            answered={answered}
            activeQuestionId={gameState.activeQuestionId}
            onOpenQuestion={openQuestion}
          />}

          {/* Share links */}
          <div className="mt-4 space-y-2">
            <ShareLink label="Board view (project this)" url={boardUrl} open />
            <ShareLink label="Player buzzer (share with players)" url={buzzUrl} open />
            <ShareLink label="Player QR code (project this)" url={qrUrl} open />
          </div>
        </div>

        {/* Right panel */}
        <div className="w-full lg:w-1/3 shrink-0 bg-gray-900 border-t lg:border-t-0 lg:border-l border-gray-700 flex flex-col overflow-hidden">

          {/* Active question panel */}
          <div className="p-5 xl:p-6 border-b border-gray-700 flex-shrink-0">
            {gameState.phase === 'lobby' ? (
              <div className="space-y-4">
              <LobbySpeakerTest roomCode={roomCode} />
              <LobbyBuzzerTest gameState={gameState} onAction={action => {
                socket.emit(SOCKET_EVENTS.HOST_LOBBY_BUZZER, { roomCode, action }, (res: { ok: boolean; error?: string }) => {
                  setHostError(res.ok ? '' : res.error ?? 'Could not update buzzer test');
                });
              }} />
              <h2 className="text-xl font-bold text-jeopardy-gold">Players & teams</h2>
              </div>
            ) : gameState.finalJeopardy ? (
              <HostFinalPanel roomCode={roomCode} gameState={gameState} board={board}
                mediaControls={<BoardMediaControls board={board} gameState={gameState} roomCode={roomCode} />} />
            ) : activeQ?.isDailyDouble && gameState.dailyDouble ? (
              <DDHostPanel
                roomCode={roomCode}
                gameState={gameState}
                activeQ={activeQ}
                onAward={awardPoints}
                onReveal={revealDD}
                onShowAnswer={showAnswer}
                onClose={closeQuestion}
                category={getCatName(activeQ)}
                mediaControls={<BoardMediaControls board={board} gameState={gameState} roomCode={roomCode} />}
              />
            ) : activeQ ? (
              <ActiveQuestionPanel
                category={getCatName(activeQ)}
                statusContent={<>
                  <QuestionCountdown gameState={gameState} />
                  {(gameState.buzzerState === 'open' || hasPendingAnswer(gameState)) && <BuzzerStatus gameState={gameState} />}
                </>}
                mediaControls={<BoardMediaControls board={board} gameState={gameState} roomCode={roomCode} />}
                activeQ={activeQ}
                clueVisible={gameState.clueVisible}
                readingClue={!!gameState.clueRecordingId}
                onRevealClue={activeQ.isDailyDouble ? activateDD : revealClue}
                responseVisible={gameState.responseVisible}
                buzzerState={gameState.buzzerState}
                buzzWinner={gameState.buzzedPlayerName ?? buzzWinner}
                buzzWinnerId={gameState.buzzedPlayerId ?? buzzWinnerId}
                players={gameState.players}
                buzzLockouts={gameState.buzzLockouts}
                buzzHistory={gameState.buzzHistory}
                collectingBuzzes={!!gameState.buzzWindow}
                buzzedPlayerId={gameState.buzzedPlayerId}
                onShowAnswer={showAnswer}
                onEnableBuzzer={enableBuzzer}
                onLockBuzzer={lockBuzzer}
                onResetBuzzer={resetBuzzer}
                onAward={awardPoints}
                onMarkWrong={markWrongAndReopen}
                onClose={closeQuestion}
              />
            ) : (
              <div className="space-y-4">
                <section aria-label="Question actions">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Question actions</h2>
                  <div className="rounded-lg bg-gray-800 px-4 py-3 text-center text-gray-400">Select a card on the board</div>
                </section>
                <section aria-label="Question status" role="status" className="rounded-xl border border-gray-700 bg-gray-950/50 p-4">
                  <h2 className="font-bold text-jeopardy-gold">Ready for a question</h2>
                  <p className="text-sm text-gray-300 mt-1">Select a card to preview its clue and answer.</p>
                </section>
              </div>
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
              <>
              {gameState.phase !== 'lobby' && <TeamsPanel gameState={gameState} roomCode={roomCode} />}
              <PlayersTab
                gameState={gameState}
                roomCode={roomCode}
                teamMode={gameState.mode === 'teams'}
                membershipLocked={gameState.mode === 'teams' && gameState.phase !== 'lobby'}
                players={gameState.players}
                addPlayerName={addPlayerName}
                onAddPlayerNameChange={setAddPlayerName}
                onAddPlayer={addPlayer}
                renamingPlayerId={renamingPlayerId}
                renameValue={renameValue}
                onRenameValueChange={setRenameValue}
                renameError={renameError}
                onStartRename={startRenamePlayer}
                onCancelRename={cancelRenamePlayer}
                onSaveRename={saveRenamePlayer}
                onAdjustScore={adjustScore}
                onRemovePlayer={removePlayer}
              />
              </>
            )}

            {/* Log tab */}
            {tab === 'log' && (
              <LogTab gameLog={gameLog} onClearLog={clearLog} />
            )}

            {/* Stats tab */}
            {tab === 'stats' && (
              <StatsTab
                playerStats={playerStats}
                answeredQuestionsCount={gameState.answeredQuestions.length}
                gameLog={gameLog}
              />
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
