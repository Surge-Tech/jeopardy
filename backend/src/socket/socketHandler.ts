import type { Server, Socket } from 'socket.io';
import * as gm from './gameManager.js';
import { registerFinalHandlers, cleanup as cleanupFinal } from './finalJeopardy.js';

// Track which socket owns which player in which room
const socketPlayers = new Map<string, { roomCode: string; playerId: string; playerName: string }>();

// Per-socket buzz rate limiting: drop anything beyond ~10 presses/sec.
const BUZZ_RATE_LIMIT = 10;
const BUZZ_RATE_WINDOW_MS = 1000;
const buzzTimestamps = new Map<string, number[]>();

function isRateLimited(socketId: string): boolean {
  const now = Date.now();
  const timestamps = (buzzTimestamps.get(socketId) ?? []).filter(t => now - t < BUZZ_RATE_WINDOW_MS);
  timestamps.push(now);
  buzzTimestamps.set(socketId, timestamps);
  return timestamps.length > BUZZ_RATE_LIMIT;
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
    socket.on('host:add-player', ({ roomCode, name, color }: { roomCode: string; name: string; color: string }) => {
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
      const outcome = gm.recordBuzz(info.roomCode, info.playerId, info.playerName);
      const session = gm.getSession(info.roomCode);
      if (outcome === 'won') {
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
      } else {
        socket.emit('buzz:too-late');
      }
    });

    // ── HOST: set buzzer lockout duration ──────────────────────────────────
    socket.on('host:set-lockout', ({ roomCode, ms }: { roomCode: string; ms: number }) => {
      gm.setLockoutMs(roomCode, ms);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: open buzzer ────────────────────────────────────────────────
    socket.on('host:enable-buzzer', ({ roomCode }: { roomCode: string }) => {
      gm.enableBuzzer(roomCode);
      io.to(roomCode).emit('buzzer:open');
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: reset buzzer (allow re-buzz) ───────────────────────────────
    socket.on('host:reset-buzzer', ({ roomCode }: { roomCode: string }) => {
      gm.resetBuzzer(roomCode);
      io.to(roomCode).emit('buzzer:open');
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: lock buzzer ────────────────────────────────────────────────
    socket.on('host:lock-buzzer', ({ roomCode }: { roomCode: string }) => {
      gm.lockBuzzer(roomCode);
      io.to(roomCode).emit('buzzer:locked');
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: open a question ────────────────────────────────────────────
    socket.on('host:open-question', ({ roomCode, questionId, isDailyDouble, boardHighValue }: { roomCode: string; questionId: string; isDailyDouble: boolean; boardHighValue?: number }) => {
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
    socket.on('host:dd-pick-player', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      const hasDevice = [...socketPlayers.values()].some(v => v.roomCode === roomCode && v.playerId === playerId);
      gm.pickDDContestant(roomCode, playerId, hasDevice);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: correct/enter a Daily Double wager on behalf of a player ────
    socket.on('host:dd-override-wager', ({ roomCode, amount }: { roomCode: string; amount: number }, ack?: (res: { ok: boolean; error?: string }) => void) => {
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
    socket.on('host:reveal-dd', ({ roomCode }: { roomCode: string }) => {
      gm.revealDailyDouble(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: show response on board view ────────────────────────────────
    socket.on('host:show-response', ({ roomCode }: { roomCode: string }) => {
      gm.showResponse(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: close/dismiss a question ───────────────────────────────────
    socket.on('host:close-question', ({ roomCode }: { roomCode: string }) => {
      gm.closeQuestion(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: award / deduct points ──────────────────────────────────────
    socket.on('host:score', ({ roomCode, playerId, delta, outcome, isDailyDouble }: { roomCode: string; playerId: string; delta: number; outcome?: 'correct' | 'wrong'; isDailyDouble?: boolean }) => {
      gm.updateScore(roomCode, playerId, delta);
      if (outcome) {
        gm.recordOutcome(roomCode, playerId, outcome);
        if (outcome === 'correct' && !isDailyDouble) gm.setLastCorrectPlayer(roomCode, playerId);
        io.to(roomCode).emit('score:result', { playerId, correct: outcome === 'correct' });
      }
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    socket.on('host:set-score', ({ roomCode, playerId, score }: { roomCode: string; playerId: string; score: number }) => {
      gm.setScore(roomCode, playerId, score);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: remove a player ────────────────────────────────────────────
    socket.on('host:remove-player', ({ roomCode, playerId }: { roomCode: string; playerId: string }) => {
      gm.removePlayer(roomCode, playerId);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: start game ─────────────────────────────────────────────────
    socket.on('host:start', ({ roomCode }: { roomCode: string }) => {
      gm.startGame(roomCode);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
    });

    // ── HOST: end / delete session ───────────────────────────────────────
    socket.on('host:end', ({ roomCode }: { roomCode: string }) => {
      io.to(roomCode).emit('game:ended');
      cleanupFinal(roomCode);
      gm.deleteSession(roomCode);
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
