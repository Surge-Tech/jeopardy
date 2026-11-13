import type { MediaCommand, MediaPlaybackStatus } from '../shared/mediaControls.js';
import { wagerPlayerId } from '../shared/competitors.js';
import type { Server, Socket } from 'socket.io';
import * as gm from './gameManager.js';
import * as boardStorage from '../storage/boardStorage.js';
import { registerFinalHandlers, cleanup as cleanupFinal } from './finalJeopardy.js';
import { onHost } from './hostAuth.js';
import { SOCKET_EVENTS } from '../shared/socketEvents.js';
import { getStartGameError } from '../shared/lobby.js';
import { LIMITS } from '../shared/limits.js';

// Track which socket owns which player in which room
const socketPlayers = new Map<string, { roomCode: string; playerId: string; playerName: string }>();

// Per-socket buzz rate limiting: drop anything beyond ~10 presses/sec.
const BUZZ_RATE_LIMIT = 10;
const BUZZ_RATE_WINDOW_MS = 1000;
const buzzTimestamps = new Map<string, number[]>();

const buzzOpenedAt = new Map<string, number>(); // roomCode -> timestamp

function isRateLimited(socketId: string): boolean {
  const now = Date.now();
  const timestamps = (buzzTimestamps.get(socketId) ?? []).filter(t => now - t < BUZZ_RATE_WINDOW_MS);
  timestamps.push(now);
  buzzTimestamps.set(socketId, timestamps);
  return timestamps.length > BUZZ_RATE_LIMIT;
}

// Tear down a room and notify connected clients.
function endRoom(io: Server, roomCode: string) {
  buzzOpenedAt.delete(roomCode);
  io.to(roomCode).emit(SOCKET_EVENTS.GAME_ENDED);
  cleanupFinal(roomCode);
  gm.deleteSession(roomCode);
}

// Idle-session reaper: a host who simply closes their browser tab without
// clicking "End Game" would otherwise leak that room's session (plus its
// Final Jeopardy secrets) for the lifetime of the
// server process. Sweeping every 15 minutes against a 6-hour idle threshold
// bounds that growth to "rooms idle for over 6 hours" while being generous
// enough to never interrupt a real game, even one paused for a long break —
// 15 minutes keeps the worst-case lag between a room going idle and being
// reaped small relative to the 6-hour threshold, without running the sweep
// often enough to matter for CPU/log noise.
const IDLE_SWEEP_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const IDLE_SESSION_MAX_AGE_MS = 6 * 60 * 60 * 1000; // 6 hours

function startIdleSessionReaper(io: Server) {
  const timer = setInterval(() => {
    const idleRooms = gm.getIdleSessions(IDLE_SESSION_MAX_AGE_MS);
    for (const roomCode of idleRooms) {
      endRoom(io, roomCode);
    }
  }, IDLE_SWEEP_INTERVAL_MS);
  timer.unref?.();
}

export function registerSocketHandlers(io: Server) {
  startIdleSessionReaper(io);

  function refreshDDDevice(roomCode: string) {
    const session = gm.getSession(roomCode);
    if (session?.dailyDouble) session.dailyDouble.hasDevice = [...socketPlayers.values()]
      .some(v => v.roomCode === roomCode && v.playerId === session.dailyDouble?.playerId);
  }

  // Phones and host test buttons use the same state transitions and broadcasts.
  function handleBuzz(socket: Socket, roomCode: string, playerId: string, playerName: string): gm.BuzzOutcome {
    const outcome = gm.recordBuzz(roomCode, playerId, playerName, buzzOpenedAt.get(roomCode) ?? null);
    const session = gm.getSession(roomCode);
    if (outcome === 'won') {
      io.to(roomCode).emit(SOCKET_EVENTS.BUZZ_WINNER, {
        playerId,
        playerName: session!.buzzedPlayerName,
        timestamp: Date.now(),
      });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, session);
      const window = session!.buzzWindow;
      setTimeout(() => {
        if (!gm.finishBuzzCollection(roomCode, window)) return;
        io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
      }, gm.BUZZ_COLLECTION_MS);
    } else if (outcome === 'early' || outcome === 'locked-out') {
      const until = session?.buzzLockouts[playerId] ?? Date.now();
      socket.emit(SOCKET_EVENTS.BUZZ_LOCKED_OUT, { until });
      io.to(`hostpanel:${roomCode}`).emit(SOCKET_EVENTS.GAME_STATE, session);
    } else if (outcome === 'recorded') {
      socket.emit(SOCKET_EVENTS.BUZZ_RECORDED);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    } else {
      socket.emit(SOCKET_EVENTS.BUZZ_TOO_LATE);
    }
    return outcome;
  }

  io.on('connection', (socket: Socket) => {
    registerFinalHandlers(io, socket, socketPlayers);

    onHost(socket, SOCKET_EVENTS.HOST_MEDIA_STATUS, ({ roomCode, mediaId, playing, currentTime, duration, playbackRate }: MediaPlaybackStatus & { roomCode: string }) => {
      if (typeof mediaId !== 'string' || mediaId.length > 512 || typeof playing !== 'boolean') return;
      const timing = { currentTime, duration, playbackRate };
      if (Object.values(timing).some(value => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))) return;
      io.to(`host:${roomCode}`).emit(SOCKET_EVENTS.BOARD_MEDIA_STATUS, { mediaId, playing,
        ...Object.fromEntries(Object.entries(timing).filter(([, value]) => value !== undefined)),
      });
    });

    onHost(socket, SOCKET_EVENTS.HOST_MEDIA_COMMAND, (payload: MediaCommand & { roomCode: string }, ack) => {
      const { roomCode, mediaId, action, value } = payload;
      if (!gm.getSession(roomCode) || typeof mediaId !== 'string' || mediaId.length > 512 ||
          !['play', 'pause', 'seek', 'seekTo', 'status'].includes(action) ||
          (action === 'seek' && (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 60)) ||
          (action === 'seekTo' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0))) {
        ack?.({ ok: false, error: 'Invalid media command' });
        return;
      }
      io.to(`host:${roomCode}`).emit(SOCKET_EVENTS.BOARD_MEDIA_COMMAND, { mediaId, action, value });
      ack?.({ ok: true });
    });

    onHost(socket, SOCKET_EVENTS.HOST_SET_MODE, ({ roomCode, mode }: { roomCode: string; mode: 'individual' | 'teams' }, ack) => {
      const res = gm.setMode(roomCode, mode);
      ack?.(res);
      if (res.ok) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });
    onHost(socket, SOCKET_EVENTS.HOST_SAVE_TEAM, ({ roomCode, id, name, color }: { roomCode: string; id?: string; name: string; color: string }, ack) => {
      const res = gm.saveTeam(roomCode, id, name, color);
      ack?.(res);
      if (res.ok) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });
    onHost(socket, SOCKET_EVENTS.HOST_REMOVE_TEAM, ({ roomCode, teamId }: { roomCode: string; teamId: string }, ack) => {
      const res = gm.removeTeam(roomCode, teamId);
      ack?.(res);
      if (res.ok) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });
    onHost(socket, SOCKET_EVENTS.HOST_ASSIGN_TEAM, ({ roomCode, playerId, teamId }: { roomCode: string; playerId: string; teamId: string | null }, ack) => {
      const res = gm.assignTeam(roomCode, playerId, teamId);
      ack?.(res);
      if (res.ok) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });
    onHost(socket, SOCKET_EVENTS.HOST_AUTO_ASSIGN_TEAMS, ({ roomCode }: { roomCode: string }, ack) => {
      const res = gm.autoAssignTeams(roomCode);
      ack?.(res);
      if (res.ok) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });
    onHost(socket, SOCKET_EVENTS.HOST_SET_CAPTAIN, ({ roomCode, teamId, playerId }: { roomCode: string; teamId: string; playerId: string }, ack) => {
      const res = gm.setCaptain(roomCode, teamId, playerId);
      refreshDDDevice(roomCode);
      ack?.(res);
      if (res.ok) io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: create a game session ──────────────────────────────────────
    socket.on(SOCKET_EVENTS.HOST_CREATE, ({ boardId, roomCode }: { boardId: string; roomCode?: string }) => {
      const existing = roomCode ? gm.getSession(roomCode) : undefined;
      const resumed = existing?.boardId === boardId;
      const session = resumed ? existing! : gm.createSession(boardId);
      socket.join(session.roomCode);
      socket.join(`host:${session.roomCode}`);
      socket.join(`hostpanel:${session.roomCode}`);
      socket.emit(SOCKET_EVENTS.HOST_CREATED, { roomCode: session.roomCode, state: session, resumed });
    });

    // ── HOST: rejoin an existing session ────────────────────────────────
    socket.on(SOCKET_EVENTS.HOST_JOIN, ({ roomCode }: { roomCode: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      socket.join(roomCode);
      socket.join(`host:${roomCode}`);
      socket.join(`hostpanel:${roomCode}`);
      socket.emit(SOCKET_EVENTS.GAME_STATE, session);
    });

    // ── PLAYER: join a game room ─────────────────────────────────────────
    socket.on(SOCKET_EVENTS.PLAYER_JOIN, ({ roomCode, name, color }: { roomCode: string; name: string; color: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      if (session.mode === 'teams' && session.phase !== 'lobby') return socket.emit('error', { message: 'Team games only accept new players in the lobby' });
      if (gm.isNameTaken(session, name)) return socket.emit('error', { message: 'That name is already taken in this game' });
      const player = gm.addPlayer(roomCode, name, color);
      if (!player) return socket.emit('error', { message: 'Could not join room' });
      socketPlayers.set(socket.id, { roomCode, playerId: player.id, playerName: name });
      socket.join(roomCode);
      socket.emit(SOCKET_EVENTS.PLAYER_JOINED, { player, state: gm.getSession(roomCode) });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: add a player with no phone of their own ─────────────────────
    // Deliberately does NOT touch socketPlayers — that map means "this
    // socket acts on this player's behalf from their own device," which is
    // never true for a host-added player (their entry would otherwise
    // falsely point at the host's own socket).
    onHost(socket, SOCKET_EVENTS.HOST_ADD_PLAYER, ({ roomCode, name, color }: { roomCode: string; name: string; color: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      if (session.mode === 'teams' && session.phase !== 'lobby') return socket.emit('error', { message: 'Team games only accept new players in the lobby' });
      if (gm.isNameTaken(session, name)) return socket.emit('error', { message: 'That name is already taken in this game' });
      const player = gm.addPlayer(roomCode, name, color);
      if (!player) return socket.emit('error', { message: 'Could not add player' });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── PLAYER: rejoin after reconnect (e.g. phone screen locked) ────────
    socket.on(SOCKET_EVENTS.PLAYER_REJOIN, ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      const player = session.players.find(p => p.id === playerId);
      if (!player) return socket.emit('error', { message: 'Player no longer in this game' });
      socketPlayers.set(socket.id, { roomCode, playerId: player.id, playerName: player.name });
      socket.join(roomCode);
      refreshDDDevice(roomCode);
      socket.emit(SOCKET_EVENTS.PLAYER_JOINED, { player, state: session });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, session);
    });

    // ── PLAYER: buzz in ──────────────────────────────────────────────────
    socket.on(SOCKET_EVENTS.BUZZ, () => {
      const info = socketPlayers.get(socket.id);
      if (!info || isRateLimited(socket.id)) return;
      handleBuzz(socket, info.roomCode, info.playerId, info.playerName);
    });

    onHost(socket, SOCKET_EVENTS.HOST_BUZZ_PLAYER, ({ roomCode, playerId }: { roomCode: string; playerId: string }, ack) => {
      const session = gm.getSession(roomCode);
      const player = session?.players.find(p => p.id === playerId);
      if (!player) return ack?.({ ok: false, error: 'Player not found in this room' });
      if (isRateLimited(socket.id)) return ack?.({ ok: false, error: 'Too many buzz attempts; try again shortly' });
      // Do not bind the host socket to the player: this is a simulated buzz,
      // not a connected player device for wagering or reconnect purposes.
      const outcome = handleBuzz(socket, roomCode, player.id, player.name);
      const result = { ok: true, outcome };
      ack?.(result);
    });

    // ── HOST: set buzzer lockout duration ──────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_SET_LOCKOUT, ({ roomCode, ms }: { roomCode: string; ms: number }) => {
      gm.setLockoutMs(roomCode, ms);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_SET_ANSWER_TIME, ({ roomCode, seconds }: { roomCode: string; seconds: number }) => {
      if (!gm.setAnswerTime(roomCode, seconds)) return;
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_SET_DD_TIME, ({ roomCode, seconds }: { roomCode: string; seconds: number }) => {
      if (!gm.setDailyDoubleTime(roomCode, seconds)) return;
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_DD_START_TIMER, ({ roomCode }: { roomCode: string }) => {
      if (!gm.startDailyDoubleTimer(roomCode)) return;
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_LOBBY_BUZZER, ({ roomCode, action }: { roomCode: string; action: 'open' | 'reset' }, ack) => {
      if (!gm.setLobbyBuzzer(roomCode, action)) return ack?.({ ok: false, error: 'Buzzer practice is only available in the lobby' });
      if (action === 'open') buzzOpenedAt.set(roomCode, Date.now());
      else buzzOpenedAt.delete(roomCode);
      ack?.({ ok: true });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: open buzzer ────────────────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_ENABLE_BUZZER, ({ roomCode }: { roomCode: string }) => {
      if (!gm.enableBuzzer(roomCode)) return;
      buzzOpenedAt.set(roomCode, Date.now());
      io.to(roomCode).emit(SOCKET_EVENTS.BUZZER_OPEN);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: reset buzzer (allow re-buzz) ───────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_RESET_BUZZER, ({ roomCode }: { roomCode: string }) => {
      if (!gm.resetBuzzer(roomCode)) return;
      buzzOpenedAt.set(roomCode, Date.now());
      io.to(roomCode).emit(SOCKET_EVENTS.BUZZER_OPEN);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: lock buzzer ────────────────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_LOCK_BUZZER, ({ roomCode }: { roomCode: string }) => {
      gm.lockBuzzer(roomCode);
      io.to(roomCode).emit(SOCKET_EVENTS.BUZZER_LOCKED);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: open a question ────────────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_OPEN_QUESTION, ({ roomCode, questionId, isDailyDouble }: { roomCode: string; questionId: string; isDailyDouble: boolean }) => {
      if (!gm.openQuestion(roomCode, questionId, isDailyDouble)) {
        if (gm.getSession(roomCode)?.phase === 'lobby') socket.emit('error', { message: 'Press Start game before selecting a question' });
        return;
      }
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // Selection only previews the card; activation starts contestant wagering.
    onHost(socket, SOCKET_EVENTS.HOST_ACTIVATE_DD, ({ roomCode, boardHighValue }: { roomCode: string; boardHighValue: number }) => {
      const session = gm.getSession(roomCode);
      if (!session?.activeQuestionId || session.phase !== 'playing' || session.finalJeopardy ||
          session.dailyDoubleRevealed || session.dailyDouble || session.clueVisible ||
          !Number.isFinite(boardHighValue) || boardHighValue < 0) return;
      const lastCorrect = session.lastCorrectPlayerId;
      const submitter = lastCorrect ? wagerPlayerId(session, lastCorrect) : null;
      const hasDevice = !!submitter && [...socketPlayers.values()]
        .some(v => v.roomCode === roomCode && v.playerId === submitter);
      gm.startDailyDoubleWager(roomCode, lastCorrect, boardHighValue, hasDevice);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, session);
    });

    // ── HOST: fallback pick of the Daily Double contestant ────────────────
    onHost(socket, SOCKET_EVENTS.HOST_DD_PICK_PLAYER, ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      const session = gm.getSession(roomCode);
      const submitter = session ? wagerPlayerId(session, playerId) : null;
      const hasDevice = [...socketPlayers.values()].some(v => v.roomCode === roomCode && v.playerId === submitter);
      gm.pickDDContestant(roomCode, playerId, hasDevice);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: correct/enter a Daily Double wager on behalf of a player ────
    onHost(socket, SOCKET_EVENTS.HOST_DD_OVERRIDE_WAGER, ({ roomCode, amount }: { roomCode: string; amount: number }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const res = gm.overrideDDWager(roomCode, amount);
      ack?.(res);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── PLAYER: submit a Daily Double wager ────────────────────────────────
    socket.on(SOCKET_EVENTS.DD_WAGER, ({ amount }: { amount: number }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const info = socketPlayers.get(socket.id);
      if (!info) return ack?.({ ok: false, error: 'Not joined' });
      const res = gm.submitDDWager(info.roomCode, info.playerId, amount);
      ack?.(res);
      io.to(info.roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(info.roomCode));
    });

    // ── HOST: reveal DD clue (after DD splash screen) ────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_REVEAL_DD, ({ roomCode }: { roomCode: string }) => {
      gm.revealDailyDouble(roomCode);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_REVEAL_CLUE, async ({ roomCode }: { roomCode: string }) => {
      const session = gm.getSession(roomCode);
      if (!session?.activeQuestionId) return;
      const questionId = session.activeQuestionId;
      const board = await boardStorage.getBoard(session.boardId);
      // The host may have closed or replaced the clue while the board loaded.
      if (gm.getSession(roomCode) !== session || session.activeQuestionId !== questionId) return;
      const question = board?.rounds[session.currentRoundIndex]?.categories
        .flatMap(category => category.questions).find(question => question.id === questionId);
      if (!gm.revealClue(roomCode, question?.mediaUrl ? question.mediaType : undefined, !!question?.clueAudioUrl, question?.clue)) return;
      if (session.buzzerState === 'open') {
        buzzOpenedAt.set(roomCode, Date.now());
        io.to(roomCode).emit(SOCKET_EVENTS.BUZZER_OPEN);
      }
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_CLUE_RECORDING_ENDED,
      ({ roomCode, questionId, recordingId }: { roomCode: string; questionId: string; recordingId: string }) => {
        if (typeof questionId !== 'string' || typeof recordingId !== 'string' ||
            !gm.finishClueRecording(roomCode, questionId, recordingId)) return;
        buzzOpenedAt.set(roomCode, Date.now());
        io.to(roomCode).emit(SOCKET_EVENTS.BUZZER_OPEN);
        io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
      });

    // ── HOST: show response on board view ────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_SHOW_RESPONSE, ({ roomCode }: { roomCode: string }) => {
      gm.showResponse(roomCode);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: close/dismiss a question ───────────────────────────────────
    // After closing, auto-ends the game only when the just-completed round
    // was the last one AND the board has no Final Jeopardy configured — with
    // FJ, or on an earlier round, the host is prompted client-side instead.
    onHost(socket, SOCKET_EVENTS.HOST_CLOSE_QUESTION, async ({ roomCode }: { roomCode: string }) => {
      if (!gm.closeQuestion(roomCode)) return;
      buzzOpenedAt.delete(roomCode);
      const session = gm.getSession(roomCode);
      if (session && session.phase !== 'finished') {
        const board = await boardStorage.getBoard(session.boardId);
        if (board) {
          const isLastRound = session.currentRoundIndex >= board.rounds.length - 1;
          const roundComplete = boardStorage.isRoundComplete(board, session.answeredQuestions, session.currentRoundIndex);
          if (isLastRound && roundComplete && !board.finalJeopardy) {
            gm.endGame(roomCode);
          }
        }
      }
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: end the game (shows the leaderboard) ────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_END_GAME, ({ roomCode }: { roomCode: string }) => {
      cleanupFinal(roomCode);
      gm.setFinalState(roomCode, null);
      gm.endGame(roomCode);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: resume a game that was ended by mistake ──────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_RESUME_GAME, ({ roomCode }: { roomCode: string }) => {
      gm.resumeGame(roomCode);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: award / deduct points ──────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_SCORE, ({ roomCode, playerId, delta, outcome, isDailyDouble }: { roomCode: string; playerId: string; delta: number; outcome?: 'correct' | 'wrong'; isDailyDouble?: boolean }, ack) => {
      // Only judged Correct/Wrong clicks (outcome present) are checked against
      // who's actually eligible right now; manual score adjustments (no
      // outcome) are a free-form host override and must not be blocked here.
      if (outcome && !gm.validateScoreEligibility(roomCode, playerId, !!isDailyDouble)) return;
      if (!gm.updateScore(roomCode, playerId, delta)) return ack?.({ ok: false, error: 'Invalid score or competitor' });
      ack?.({ ok: true });
      if (outcome) {
        gm.recordOutcome(roomCode, playerId, outcome);
        if (outcome === 'correct' && !isDailyDouble) gm.setLastCorrectPlayer(roomCode, playerId);
        io.to(roomCode).emit(SOCKET_EVENTS.SCORE_RESULT, { playerId, correct: outcome === 'correct' });
      }
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    onHost(socket, SOCKET_EVENTS.HOST_SET_SCORE, ({ roomCode, playerId, score }: { roomCode: string; playerId: string; score: number }) => {
      gm.setScore(roomCode, playerId, score);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── PLAYER: rename themselves (lobby only) ───────────────────────────
    socket.on(SOCKET_EVENTS.PLAYER_RENAME, ({ newName }: { newName: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const info = socketPlayers.get(socket.id);
      if (!info) return ack?.({ ok: false, error: 'Not joined' });
      const session = gm.getSession(info.roomCode);
      if (!session) return ack?.({ ok: false, error: 'Room not found' });
      if (session.phase !== 'lobby') return ack?.({ ok: false, error: 'Name changes only allowed in lobby' });
      const trimmed = newName.trim();
      if (!trimmed) return ack?.({ ok: false, error: 'Name cannot be empty' });
      const res = gm.renamePlayer(info.roomCode, info.playerId, trimmed);
      if (!res.ok) return ack?.(res);
      socketPlayers.set(socket.id, { ...info, playerName: trimmed.slice(0, LIMITS.PLAYER_NAME_MAX) });
      ack?.({ ok: true });
      io.to(info.roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(info.roomCode));
    });

    // ── HOST: rename any player ───────────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_RENAME_PLAYER, ({ roomCode, playerId, newName }: { roomCode: string; playerId: string; newName: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const trimmed = newName.trim();
      if (!trimmed) return ack?.({ ok: false, error: 'Name cannot be empty' });
      const res = gm.renamePlayer(roomCode, playerId, trimmed);
      if (!res.ok) return ack?.(res);
      // Update socketPlayers entry for this player if they have a live socket
      for (const [sid, info] of socketPlayers) {
        if (info.roomCode === roomCode && info.playerId === playerId) {
          socketPlayers.set(sid, { ...info, playerName: trimmed.slice(0, LIMITS.PLAYER_NAME_MAX) });
          break;
        }
      }
      ack?.({ ok: true });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: remove a player ────────────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_REMOVE_PLAYER, ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      gm.removePlayer(roomCode, playerId);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: start game ─────────────────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_START, ({ roomCode }: { roomCode: string }, ack) => {
      const session = gm.getSession(roomCode);
      const error = session ? getStartGameError(session) : 'Room not found';
      if (error) return ack?.({ ok: false, error });
      if (!gm.startGame(roomCode)) return ack?.({ ok: false, error: 'Could not start game' });
      ack?.({ ok: true });
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── HOST: advance to the next round ────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_NEXT_ROUND, async ({ roomCode }: { roomCode: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const session = gm.getSession(roomCode);
      if (!session) return ack?.({ ok: false, error: 'Room not found' });
      const board = await boardStorage.getBoard(session.boardId);
      if (!board) return ack?.({ ok: false, error: 'Board not found' });
      const res = gm.advanceRound(roomCode, board.rounds.length);
      ack?.(res);
      if (res.ok) {
        const updated = gm.getSession(roomCode);
        const round = board.rounds[updated!.currentRoundIndex];
        io.to(roomCode).emit(SOCKET_EVENTS.ROUND_CHANGED, { index: updated!.currentRoundIndex, name: round?.name ?? null });
        io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, updated);
      }
    });

    // ── HOST: end / delete session ───────────────────────────────────────
    onHost(socket, SOCKET_EVENTS.HOST_END, ({ roomCode }: { roomCode: string }) => {
      endRoom(io, roomCode);
    });

    // ── HOST: wrong answer — reopen for a fresh buzz ──────────
    onHost(socket, SOCKET_EVENTS.HOST_WRONG_REOPEN, ({ roomCode, playerId, delta }: { roomCode: string; playerId: string; delta: number }) => {
      const ok = gm.markWrongAndReopen(roomCode, playerId, delta);
      if (!ok) return;
      io.to(roomCode).emit(SOCKET_EVENTS.SCORE_RESULT, { playerId, correct: false });

      buzzOpenedAt.set(roomCode, Date.now());
      io.to(roomCode).emit(SOCKET_EVENTS.BUZZER_OPEN);
      io.to(roomCode).emit(SOCKET_EVENTS.GAME_STATE, gm.getSession(roomCode));
    });

    // ── REQUEST state (any client) ───────────────────────────────────────
    socket.on(SOCKET_EVENTS.GET_STATE, ({ roomCode }: { roomCode: string }) => {
      const session = gm.getSession(roomCode);
      if (session) socket.emit(SOCKET_EVENTS.GAME_STATE, session);
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const info = socketPlayers.get(socket.id);
      buzzTimestamps.delete(socket.id);
      if (info) {
        socketPlayers.delete(socket.id);
        // Don't auto-remove player on disconnect so they can reconnect
        refreshDDDevice(info.roomCode);
        const session = gm.getSession(info.roomCode);
        if (session) io.to(info.roomCode).emit(SOCKET_EVENTS.GAME_STATE, session);
      }
    });
  });
}
