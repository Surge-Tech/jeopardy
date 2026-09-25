import type { Server, Socket } from 'socket.io';
import * as gm from './gameManager.js';
import * as boardStorage from '../storage/boardStorage.js';
import { registerFinalHandlers, cleanup as cleanupFinal } from './finalJeopardy.js';
import { onHost } from './hostAuth.js';

// Track which socket owns which player in which room
const socketPlayers = new Map<string, { roomCode: string; playerId: string; playerName: string }>();

// Per-socket buzz rate limiting: drop anything beyond ~10 presses/sec.
const BUZZ_RATE_LIMIT = 10;
const BUZZ_RATE_WINDOW_MS = 1000;
const buzzTimestamps = new Map<string, number[]>();

const buzzOpenedAt = new Map<string, number>(); // roomCode -> timestamp
const autoLockTimers = new Map<string, NodeJS.Timeout>(); // roomCode -> timer

function isRateLimited(socketId: string): boolean {
  const now = Date.now();
  const timestamps = (buzzTimestamps.get(socketId) ?? []).filter(t => now - t < BUZZ_RATE_WINDOW_MS);
  timestamps.push(now);
  buzzTimestamps.set(socketId, timestamps);
  return timestamps.length > BUZZ_RATE_LIMIT;
}

function cancelAutoLockTimer(roomCode: string) {
  const t = autoLockTimers.get(roomCode);
  if (t) { clearTimeout(t); autoLockTimers.delete(roomCode); }
}

function startAutoLockTimer(io: Server, roomCode: string) {
  cancelAutoLockTimer(roomCode);
  const session = gm.getSession(roomCode);
  if (!session?.settings.autoLockEnabled) return;
  const ms = (session.settings.autoLockTimeoutS ?? 7) * 1000;
  const t = setTimeout(() => {
    autoLockTimers.delete(roomCode);
    gm.lockBuzzer(roomCode);
    const s = gm.getSession(roomCode);
    io.to(roomCode).emit('game:state', s);
    io.to(`hostpanel:${roomCode}`).emit('buzz:queue-locked', { auto: true });
  }, ms);
  autoLockTimers.set(roomCode, t);
}

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    registerFinalHandlers(io, socket, socketPlayers);

    // ── HOST: create a game session ──────────────────────────────────────
    socket.on('host:create', ({ boardId }: { boardId: string }) => {
      const session = gm.createSession(boardId);
      socket.join(session.roomCode);
      socket.join(`host:${session.roomCode}`);
      socket.join(`hostpanel:${session.roomCode}`);
      socket.emit('host:created', { roomCode: session.roomCode, state: session });
    });

    // ── HOST: rejoin an existing session ────────────────────────────────
    socket.on('host:join', ({ roomCode }: { roomCode: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      socket.join(roomCode);
      socket.join(`host:${roomCode}`);
      socket.join(`hostpanel:${roomCode}`);
      socket.emit('game:state', session);
    });

    // ── PLAYER: join a game room ─────────────────────────────────────────
    socket.on('player:join', ({ roomCode, name, color }: { roomCode: string; name: string; color: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      const player = gm.addPlayer(roomCode, name, color);
      if (!player) return socket.emit('error', { message: 'Could not join room' });
      socketPlayers.set(socket.id, { roomCode, playerId: player.id, playerName: name });
      socket.join(roomCode);
      socket.emit('player:joined', { player, state: gm.getSession(roomCode) });
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: add a player with no phone of their own ─────────────────────
    // Deliberately does NOT touch socketPlayers — that map means "this
    // socket acts on this player's behalf from their own device," which is
    // never true for a host-added player (their entry would otherwise
    // falsely point at the host's own socket).
    onHost(socket, 'host:add-player', ({ roomCode, name, color }: { roomCode: string; name: string; color: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      const player = gm.addPlayer(roomCode, name, color);
      if (!player) return socket.emit('error', { message: 'Could not add player' });
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── PLAYER: rejoin after reconnect (e.g. phone screen locked) ────────
    socket.on('player:rejoin', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      const player = session.players.find(p => p.id === playerId);
      if (!player) return socket.emit('error', { message: 'Player no longer in this game' });
      socketPlayers.set(socket.id, { roomCode, playerId: player.id, playerName: player.name });
      socket.join(roomCode);
      socket.emit('player:joined', { player, state: session });
    });

    // ── PLAYER: buzz in ──────────────────────────────────────────────────
    socket.on('buzz', () => {
      const info = socketPlayers.get(socket.id);
      if (!info) return;
      if (isRateLimited(socket.id)) return;
      const outcome = gm.recordBuzz(info.roomCode, info.playerId, info.playerName, buzzOpenedAt.get(info.roomCode) ?? null);
      const session = gm.getSession(info.roomCode);
      if (outcome === 'won') {
        cancelAutoLockTimer(info.roomCode);
        io.to(info.roomCode).emit('buzz:winner', {
          playerId: info.playerId,
          playerName: info.playerName,
          timestamp: Date.now(),
        });
        io.to(info.roomCode).emit('game:state', session);
      } else if (outcome === 'early' || outcome === 'locked-out') {
        const until = session?.buzzLockouts[info.playerId] ?? Date.now();
        socket.emit('buzz:locked-out', { until });
        io.to(`hostpanel:${info.roomCode}`).emit('game:state', session);
      } else if (outcome === 'queued') {
        socket.emit('buzz:queued');
        io.to(`hostpanel:${info.roomCode}`).emit('game:state', gm.getSession(info.roomCode));
      } else {
        socket.emit('buzz:too-late');
      }
    });

    // ── HOST: set buzzer lockout duration ──────────────────────────────────
    onHost(socket, 'host:set-lockout', ({ roomCode, ms }: { roomCode: string; ms: number }) => {
      gm.setLockoutMs(roomCode, ms);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: open buzzer ────────────────────────────────────────────────
    onHost(socket, 'host:enable-buzzer', ({ roomCode }: { roomCode: string }) => {
      gm.enableBuzzer(roomCode);
      buzzOpenedAt.set(roomCode, Date.now());
      startAutoLockTimer(io, roomCode);
      io.to(roomCode).emit('buzzer:open');
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: reset buzzer (allow re-buzz) ───────────────────────────────
    onHost(socket, 'host:reset-buzzer', ({ roomCode }: { roomCode: string }) => {
      gm.resetBuzzer(roomCode);
      buzzOpenedAt.set(roomCode, Date.now());
      startAutoLockTimer(io, roomCode);
      io.to(roomCode).emit('buzzer:open');
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: lock buzzer ────────────────────────────────────────────────
    onHost(socket, 'host:lock-buzzer', ({ roomCode }: { roomCode: string }) => {
      cancelAutoLockTimer(roomCode);
      gm.lockBuzzer(roomCode);
      io.to(roomCode).emit('buzzer:locked');
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: open a question ────────────────────────────────────────────
    onHost(socket, 'host:open-question', ({ roomCode, questionId, isDailyDouble, boardHighValue }: { roomCode: string; questionId: string; isDailyDouble: boolean; boardHighValue?: number }) => {
      gm.openQuestion(roomCode, questionId, isDailyDouble);
      if (isDailyDouble) {
        const session = gm.getSession(roomCode);
        const lastCorrect = session?.lastCorrectPlayerId ?? null;
        const hasDevice = lastCorrect
          ? [...socketPlayers.values()].some(v => v.roomCode === roomCode && v.playerId === lastCorrect)
          : false;
        gm.startDailyDoubleWager(roomCode, lastCorrect, boardHighValue ?? 0, hasDevice);
      }
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: fallback pick of the Daily Double contestant ────────────────
    onHost(socket, 'host:dd-pick-player', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      const hasDevice = [...socketPlayers.values()].some(v => v.roomCode === roomCode && v.playerId === playerId);
      gm.pickDDContestant(roomCode, playerId, hasDevice);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: correct/enter a Daily Double wager on behalf of a player ────
    onHost(socket, 'host:dd-override-wager', ({ roomCode, amount }: { roomCode: string; amount: number }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const res = gm.overrideDDWager(roomCode, amount);
      ack?.(res);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── PLAYER: submit a Daily Double wager ────────────────────────────────
    socket.on('dd:wager', ({ amount }: { amount: number }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const info = socketPlayers.get(socket.id);
      if (!info) return ack?.({ ok: false, error: 'Not joined' });
      const res = gm.submitDDWager(info.roomCode, info.playerId, amount);
      ack?.(res);
      io.to(info.roomCode).emit('game:state', gm.getSession(info.roomCode));
    });

    // ── HOST: reveal DD clue (after DD splash screen) ────────────────────
    onHost(socket, 'host:reveal-dd', ({ roomCode }: { roomCode: string }) => {
      gm.revealDailyDouble(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: show response on board view ────────────────────────────────
    onHost(socket, 'host:show-response', ({ roomCode }: { roomCode: string }) => {
      gm.showResponse(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: close/dismiss a question ───────────────────────────────────
    // After closing, auto-ends the game only when the just-completed round
    // was the last one AND the board has no Final Jeopardy configured — with
    // FJ, or on an earlier round, the host is prompted client-side instead.
    onHost(socket, 'host:close-question', async ({ roomCode }: { roomCode: string }) => {
      cancelAutoLockTimer(roomCode);
      buzzOpenedAt.delete(roomCode);
      gm.closeQuestion(roomCode);
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
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: end the game (shows the leaderboard) ────────────────────────
    onHost(socket, 'host:end-game', ({ roomCode }: { roomCode: string }) => {
      cleanupFinal(roomCode);
      gm.setFinalState(roomCode, null);
      gm.endGame(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: resume a game that was ended by mistake ──────────────────────
    onHost(socket, 'host:resume-game', ({ roomCode }: { roomCode: string }) => {
      gm.resumeGame(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: award / deduct points ──────────────────────────────────────
    onHost(socket, 'host:score', ({ roomCode, playerId, delta, outcome, isDailyDouble }: { roomCode: string; playerId: string; delta: number; outcome?: 'correct' | 'wrong'; isDailyDouble?: boolean }) => {
      gm.updateScore(roomCode, playerId, delta);
      if (outcome) {
        gm.recordOutcome(roomCode, playerId, outcome);
        if (outcome === 'correct' && !isDailyDouble) gm.setLastCorrectPlayer(roomCode, playerId);
        io.to(roomCode).emit('score:result', { playerId, correct: outcome === 'correct' });
      }
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    onHost(socket, 'host:set-score', ({ roomCode, playerId, score }: { roomCode: string; playerId: string; score: number }) => {
      gm.setScore(roomCode, playerId, score);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── PLAYER: rename themselves (lobby only) ───────────────────────────
    socket.on('player:rename', ({ newName }: { newName: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const info = socketPlayers.get(socket.id);
      if (!info) return ack?.({ ok: false, error: 'Not joined' });
      const session = gm.getSession(info.roomCode);
      if (!session) return ack?.({ ok: false, error: 'Room not found' });
      if (session.phase !== 'lobby') return ack?.({ ok: false, error: 'Name changes only allowed in lobby' });
      const trimmed = newName.trim();
      if (!trimmed) return ack?.({ ok: false, error: 'Name cannot be empty' });
      gm.renamePlayer(info.roomCode, info.playerId, trimmed);
      socketPlayers.set(socket.id, { ...info, playerName: trimmed.slice(0, 32) });
      ack?.({ ok: true });
      io.to(info.roomCode).emit('game:state', gm.getSession(info.roomCode));
    });

    // ── HOST: rename any player ───────────────────────────────────────────
    onHost(socket, 'host:rename-player', ({ roomCode, playerId, newName }: { roomCode: string; playerId: string; newName: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const trimmed = newName.trim();
      if (!trimmed) return ack?.({ ok: false, error: 'Name cannot be empty' });
      const renamed = gm.renamePlayer(roomCode, playerId, trimmed);
      if (!renamed) return ack?.({ ok: false, error: 'Player not found' });
      // Update socketPlayers entry for this player if they have a live socket
      for (const [sid, info] of socketPlayers) {
        if (info.roomCode === roomCode && info.playerId === playerId) {
          socketPlayers.set(sid, { ...info, playerName: trimmed.slice(0, 32) });
          break;
        }
      }
      ack?.({ ok: true });
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: remove a player ────────────────────────────────────────────
    onHost(socket, 'host:remove-player', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      gm.removePlayer(roomCode, playerId);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: start game ─────────────────────────────────────────────────
    onHost(socket, 'host:start', ({ roomCode }: { roomCode: string }) => {
      gm.startGame(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: advance to the next round ────────────────────────────────────
    onHost(socket, 'host:next-round', async ({ roomCode }: { roomCode: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      const session = gm.getSession(roomCode);
      if (!session) return ack?.({ ok: false, error: 'Room not found' });
      const board = await boardStorage.getBoard(session.boardId);
      if (!board) return ack?.({ ok: false, error: 'Board not found' });
      const res = gm.advanceRound(roomCode, board.rounds.length);
      ack?.(res);
      if (res.ok) {
        const updated = gm.getSession(roomCode);
        const round = board.rounds[updated!.currentRoundIndex];
        io.to(roomCode).emit('round:changed', { index: updated!.currentRoundIndex, name: round?.name ?? null });
        io.to(roomCode).emit('game:state', updated);
      }
    });

    // ── HOST: end / delete session ───────────────────────────────────────
    onHost(socket, 'host:end', ({ roomCode }: { roomCode: string }) => {
      cancelAutoLockTimer(roomCode);
      buzzOpenedAt.delete(roomCode);
      io.to(roomCode).emit('game:ended');
      cleanupFinal(roomCode);
      gm.deleteSession(roomCode);
    });

    // ── HOST: wrong answer — reopen or advance to next in queue ──────────
    onHost(socket, 'host:wrong-reopen', ({ roomCode, playerId, delta }: { roomCode: string; playerId: string; delta: number }) => {
      gm.markWrongAndReopen(roomCode, playerId, delta);
      io.to(roomCode).emit('score:result', { playerId, correct: false });

      gm.markBuzzAttempted(roomCode, playerId);

      const session = gm.getSession(roomCode);
      if (!session) return;
      const ineligibleIds = new Set(
        Object.keys(session.buzzLockouts).filter(id => session.buzzLockouts[id] === gm.PERMANENT_LOCKOUT)
      );

      const next = gm.getNextInQueue(roomCode, ineligibleIds);
      if (next) {
        gm.advanceToBuzzEntry(roomCode, next);
        const updated = gm.getSession(roomCode);
        io.to(roomCode).emit('buzz:winner', {
          playerId: next.playerId,
          playerName: next.playerName,
          timestamp: Date.now(),
        });
        io.to(roomCode).emit('game:state', updated);
        io.to(`hostpanel:${roomCode}`).emit('buzz:next-in-queue', {
          playerId: next.playerId,
          playerName: next.playerName,
        });
      } else {
        gm.resetBuzzer(roomCode);
        buzzOpenedAt.set(roomCode, Date.now());
        io.to(roomCode).emit('buzzer:open');
        io.to(roomCode).emit('game:state', gm.getSession(roomCode));
        startAutoLockTimer(io, roomCode);
      }
    });

    // ── HOST: toggle auto-lock ────────────────────────────────────────────
    onHost(socket, 'host:set-auto-lock', ({ roomCode, enabled }: { roomCode: string; enabled: boolean }) => {
      gm.setAutoLock(roomCode, enabled);
      if (!enabled) cancelAutoLockTimer(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: set auto-lock timeout ────────────────────────────────────────
    onHost(socket, 'host:set-auto-lock-timeout', ({ roomCode, seconds }: { roomCode: string; seconds: number }) => {
      const ok = gm.setAutoLockTimeout(roomCode, seconds);
      if (ok) io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── REQUEST state (any client) ───────────────────────────────────────
    socket.on('get:state', ({ roomCode }: { roomCode: string }) => {
      const session = gm.getSession(roomCode);
      if (session) socket.emit('game:state', session);
    });

    // ── DISCONNECT ───────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const info = socketPlayers.get(socket.id);
      buzzTimestamps.delete(socket.id);
      if (info) {
        socketPlayers.delete(socket.id);
        // Don't auto-remove player on disconnect so they can reconnect
        const session = gm.getSession(info.roomCode);
        if (session) io.to(info.roomCode).emit('game:state', session);
      }
    });
  });
}
