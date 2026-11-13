import { getCompetitors } from '@shared/competitors';
import ResponseMedia from '../components/shared/ResponseMedia';
import QuestionClueMedia from '../components/shared/QuestionClueMedia';
import BoardBuzzerDock from '../components/shared/BoardBuzzerDock';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { socket } from '../socket';
import { useGameStore } from '../store/gameStore';
import type { Board, GameState, Question } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';
import { playDailyDouble, playBuzzerReady, playBuzzIn, playWrong } from '../utils/sounds';
import FinalBoardScreen from '../components/final/FinalBoardScreen';
import LobbyBoardScreen from '../components/shared/LobbyBoardScreen';
import Leaderboard from '../components/shared/Leaderboard';
import SoundControl from '../components/shared/SoundControl';
import { getRound, isRoundComplete } from '../utils/rounds';
import { formatScore } from '../utils/format';

const API = '/api';

export default function BoardView() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const { gameState, setGameState } = useGameStore();
  const [board, setBoard] = useState<Board | null>(null);
  const [showQuestion, setShowQuestion] = useState<Question | null>(null);
  const [buzzWinner, setBuzzWinner] = useState<{ playerName: string } | null>(null);
  const [roundSplash, setRoundSplash] = useState<{ index: number; name: string | null } | null>(null);
  const [roomClosed, setRoomClosed] = useState(false);
  const prevBuzzerState = useRef<string>('idle');
  const prevActiveId = useRef<string | null>(null);

  useEffect(() => {
    function relay(command: import('@shared/mediaControls').MediaCommand) {
      window.dispatchEvent(new CustomEvent('board-media-command', { detail: command }));
    }
    function report(event: Event) {
      if (!roomCode) return;
      socket.emit(SOCKET_EVENTS.HOST_MEDIA_STATUS, { roomCode, ...(event as CustomEvent<import('@shared/mediaControls').MediaPlaybackStatus>).detail });
    }
    socket.on(SOCKET_EVENTS.BOARD_MEDIA_COMMAND, relay);
    window.addEventListener('board-media-status', report);
    return () => {
      socket.off(SOCKET_EVENTS.BOARD_MEDIA_COMMAND, relay);
      window.removeEventListener('board-media-status', report);
    };
  }, [roomCode]);

  // Re-join the host:<roomCode> room after a socket reconnect (WiFi blip,
  // browser sleep, backend restart) so this board keeps receiving host-only state.
  useEffect(() => {
    if (!roomCode) return;
    function rejoin() { socket.emit(SOCKET_EVENTS.HOST_JOIN, { roomCode }); }
    socket.on('connect', rejoin);
    return () => { socket.off('connect', rejoin); };
  }, [roomCode]);

  useEffect(() => {
    if (!roomCode) return;
    socket.emit(SOCKET_EVENTS.HOST_JOIN, { roomCode });
    socket.on(SOCKET_EVENTS.GAME_STATE, (state: GameState) => {
      setGameState(state);
      if (!board && state.boardId) {
        fetch(`${API}/boards/${state.boardId}`).then(r => r.json()).then(setBoard);
      }
      // Play sound when buzzers first open
      if (state.buzzerState === 'open' && prevBuzzerState.current !== 'open') {
        playBuzzerReady();
      }
      prevBuzzerState.current = state.buzzerState;
    });
    socket.on(SOCKET_EVENTS.BUZZ_WINNER, ({ playerName }: { playerName: string }) => {
      setBuzzWinner({ playerName });
      playBuzzIn();
      setTimeout(() => setBuzzWinner(null), 1500);
    });
    socket.on(SOCKET_EVENTS.SCORE_RESULT, ({ correct }: { correct: boolean }) => {
      if (!correct) playWrong();
    });
    socket.on(SOCKET_EVENTS.ROUND_CHANGED, ({ index, name }: { index: number; name: string | null }) => {
      setRoundSplash({ index, name });
      setTimeout(() => setRoundSplash(null), 3000);
    });
    socket.on(SOCKET_EVENTS.GAME_ENDED, () => setRoomClosed(true));
    socket.emit(SOCKET_EVENTS.GET_STATE, { roomCode });
    return () => {
      socket.off('game:state');
      socket.off('buzz:winner');
      socket.off('score:result');
      socket.off('round:changed');
      socket.off('game:ended');
    };
  }, [roomCode]);

  // Sync active question display + play DD sound
  useEffect(() => {
    if (!gameState || !board) return;
    if (!gameState.activeQuestionId) { setShowQuestion(null); return; }
    if (gameState.activeQuestionId === prevActiveId.current) return;
    prevActiveId.current = gameState.activeQuestionId;
    const round = getRound(board, gameState);
    const q = round.categories.flatMap(c => c.questions).find(q => q.id === gameState.activeQuestionId);
    setShowQuestion(q ?? null);
    if (q?.isDailyDouble) playDailyDouble();
  }, [gameState?.activeQuestionId, board, gameState?.currentRoundIndex]);

  if (roomClosed) {
    return (
      <div className="min-h-screen bg-jeopardy-dark flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-black text-jeopardy-gold mb-4">Room Closed</h1>
          <p className="text-gray-400">The host ended this game session.</p>
        </div>
      </div>
    );
  }

  if (!gameState || !board) {
    return (
      <div className="min-h-screen bg-jeopardy-dark flex items-center justify-center">
        <SoundControl />
        <div className="text-center">
          <h1 className="text-4xl font-black text-jeopardy-gold mb-4">Connecting...</h1>
          <p className="text-gray-400">Room: {roomCode}</p>
        </div>
      </div>
    );
  }

  if (gameState.phase === 'lobby') {
    return <><SoundControl /><LobbyBoardScreen gameState={gameState} boardName={board.name} /></>;
  }

  if (gameState.phase === 'finished') {
    return (
      <div className="min-h-screen bg-jeopardy-dark flex items-center justify-center py-12" style={{ fontFamily: 'Arial Black, Impact, sans-serif' }}>
        <SoundControl />
        <Leaderboard gameState={gameState} />
      </div>
    );
  }

  const answeredSet = new Set(gameState.answeredQuestions);
  const round = getRound(board, gameState);
  const roundComplete = isRoundComplete(board, gameState.answeredQuestions, gameState.currentRoundIndex);
  const isLastRound = gameState.currentRoundIndex >= board.rounds.length - 1;
  const isDDSplash = showQuestion?.isDailyDouble && (
    !gameState.dailyDoubleRevealed || (gameState.dailyDouble != null && gameState.dailyDouble.stage !== 'ready')
  );

  return (
    <div className="min-h-screen bg-jeopardy-dark flex flex-col overflow-hidden" style={{ fontFamily: 'Arial Black, Impact, sans-serif' }}>
      <SoundControl />

      {/* Final Jeopardy takes over the whole screen once it starts */}
      {gameState.finalJeopardy && <FinalBoardScreen gameState={gameState} />}

      {/* Round splash — shown briefly when the host advances to a new round */}
      {roundSplash && !gameState.finalJeopardy && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center"
             style={{ background: 'linear-gradient(135deg, #060CE9 0%, #0A0A2E 100%)' }}>
          <div className="text-jeopardy-gold font-black dd-reveal text-center"
               style={{ fontSize: 'clamp(36px, 9vw, 110px)', textShadow: '4px 4px 0 #000, 0 0 40px rgba(255,215,0,0.5)', letterSpacing: '0.06em' }}>
            {roundSplash.name ?? `Round ${roundSplash.index + 1}`}
          </div>
        </div>
      )}

      {/* End-of-round interstitial — shown when the round is done but it isn't the last one */}
      {!gameState.finalJeopardy && !roundSplash && roundComplete && !isLastRound && !gameState.activeQuestionId && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center bg-jeopardy-dark/95">
          <div className="text-jeopardy-gold font-black text-4xl mb-4" style={{ textShadow: '2px 2px 0 #000' }}>
            End of {round.name ?? 'Round'}
          </div>
          <p className="text-gray-400 text-xl animate-pulse">Waiting for the host to start the next round…</p>
        </div>
      )}
      {/* Brief buzz announcement; the persistent card keeps the timer visible. */}
      {buzzWinner && (
        <div className="buzz-announcement" aria-hidden="true">
          <span className="buzzer-status__eyebrow">First buzz</span>
          <span className="buzz-announcement__name">{buzzWinner.playerName}</span>
        </div>
      )}

      {/* Daily Double splash — shown instead of clue until host reveals */}
      {isDDSplash && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center"
             style={{ background: 'linear-gradient(135deg, #060CE9 0%, #0A0A2E 100%)' }}>
          <div className="text-jeopardy-gold font-black dd-reveal"
               style={{ fontSize: 'clamp(48px, 12vw, 140px)', textShadow: '4px 4px 0 #000, 0 0 40px rgba(255,215,0,0.5)', letterSpacing: '0.08em' }}>
            DAILY
          </div>
          <div className="text-jeopardy-gold font-black dd-reveal"
               style={{ fontSize: 'clamp(48px, 12vw, 140px)', textShadow: '4px 4px 0 #000, 0 0 40px rgba(255,215,0,0.5)', letterSpacing: '0.08em', animationDelay: '0.15s' }}>
            DOUBLE!
          </div>
          <div className="mt-8 text-white text-xl font-bold opacity-60 animate-pulse">
            {showQuestion?.value}
          </div>
        </div>
      )}

      {/* Question overlay — shown only after the host reveals the clue */}
      {showQuestion && !isDDSplash && (showQuestion.isDailyDouble || gameState.clueVisible) && (
        <div className="fixed inset-0 bg-jeopardy-blue z-40 overflow-hidden flip-in">
          <div className={`board-clue-content ${showQuestion.isDailyDouble ? 'board-clue-content--solo' : ''}`}>
          <div className={`my-auto flex w-full shrink-0 flex-col items-center ${gameState.responseVisible ? 'board-clue-content--answered' : ''}`}>
          <div className="text-jeopardy-gold font-black text-2xl mb-4 tracking-widest">
            {showQuestion.value}
            {showQuestion.isDailyDouble && (
              <span className="ml-4 bg-yellow-400 text-black px-3 py-1 rounded text-xl">DAILY DOUBLE!</span>
            )}
          </div>

          {/* Media */}
          <QuestionClueMedia key={showQuestion.id} question={showQuestion} gameState={gameState} roomCode={roomCode!} />

          {/* Clue text */}
          <div className="text-white text-center text-3xl md:text-5xl font-black max-w-4xl leading-tight"
               style={{ textShadow: '2px 2px 0 #000' }}>
            {showQuestion.clue}
          </div>

          {/* Answer — shown when host clicks "Show Answer" */}
          {gameState.responseVisible && (
            <div className={`board-answer mt-8 fade-up bg-black/90 border-2 border-jeopardy-gold rounded-xl px-8 py-4 text-center w-full max-w-3xl ${showQuestion.mediaType === 'image' ? `board-answer-overlay ${showQuestion.isDailyDouble ? 'board-answer-overlay--solo' : ''}` : ''}`}>
              <div className="text-gray-400 text-lg mb-1 uppercase tracking-widest">Answer</div>
              <div className="text-jeopardy-gold font-black text-2xl md:text-3xl" style={{ textShadow: '2px 2px 0 #000' }}>
                {showQuestion.response}
              </div>
              {showQuestion.responseMediaType && showQuestion.responseMediaUrl && (
                <div className={`board-answer-media board-answer-media--${showQuestion.responseMediaType}`}>
                  <ResponseMedia {...showQuestion} autoPlay controlId={`${showQuestion.id}:response`} />
                </div>
              )}
            </div>
          )}

          </div>
          </div>

          <BoardBuzzerDock gameState={gameState} />
        </div>
      )}

      {/* Board grid */}
      <div className="flex-1 grid" style={{
        gridTemplateColumns: `repeat(${round.categories.length}, 1fr)`,
        gap: '4px',
        padding: '4px',
      }}>
        {/* Category headers */}
        {round.categories.map(cat => (
          <div
            key={cat.id}
            className="bg-jeopardy-blue border-4 border-black text-jeopardy-gold font-black text-center flex items-center justify-center p-2"
            style={{ minHeight: '80px', fontSize: 'clamp(10px, 1.5vw, 20px)', textTransform: 'uppercase', textShadow: '1px 1px 0 #000' }}
          >
            {cat.name || 'CATEGORY'}
          </div>
        ))}

        {/* Question cells */}
        {round.pointValues.map(pv => (
          round.categories.map(cat => {
            const q = cat.questions.find(q => q.value === pv);
            const isAnswered = q ? answeredSet.has(q.id) : false;
            return (
              <div
                key={`${cat.id}-${pv}`}
                className={`border-4 border-black flex items-center justify-center font-black text-center
                  ${isAnswered ? 'bg-jeopardy-dark text-gray-800' : 'bg-jeopardy-blue text-jeopardy-gold'}`}
                style={{ fontSize: 'clamp(18px, 3vw, 48px)', textShadow: isAnswered ? 'none' : '2px 2px 0 #000', minHeight: '60px' }}
              >
                {isAnswered ? '' : pv}
              </div>
            );
          })
        ))}
      </div>

      {/* Score bar */}
      <div className="bg-black border-t-4 border-jeopardy-gold flex">
        {getCompetitors(gameState).map(player => (
          <div
            key={player.id}
            className="flex-1 text-center py-2 border-r border-gray-700 last:border-0"
            style={{ borderBottomColor: player.color, borderBottomWidth: 4 }}
          >
            <div className="text-white font-bold text-sm truncate px-2">{player.name}</div>
            <div
              className="font-black text-xl"
              style={{ color: player.score < 0 ? '#ef4444' : '#FFD700' }}
            >
              {formatScore(player.score)}
            </div>
          </div>
        ))}
        {gameState.players.length === 0 && (
          <div className="flex-1 text-center py-2 text-gray-600 text-sm">No players yet</div>
        )}
      </div>
    </div>
  );
}
