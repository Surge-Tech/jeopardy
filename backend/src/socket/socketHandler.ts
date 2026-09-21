import type { Server, Socket } from 'socket.io';
import * as gm from './gameManager.js';

// Track which socket owns which player in which room
const socketPlayers = new Map<string, { roomCode: string; playerId: string; playerName: string }>();

export function registerSocketHandlers(io: Server) {
  io.on('connection', (socket: Socket) => {
    // ── HOST: create a game session ──────────────────────────────────────
    socket.on('host:create', ({ boardId }: { boardId: string }) => {
      const session = gm.createSession(boardId);
      socket.join(session.roomCode);
      socket.join(`host:${session.roomCode}`);
      socket.emit('host:created', { roomCode: session.roomCode, state: session });
    });

    // ── HOST: rejoin an existing session ────────────────────────────────
    socket.on('host:join', ({ roomCode }: { roomCode: string }) => {
      const session = gm.getSession(roomCode);
      if (!session) return socket.emit('error', { message: 'Room not found' });
      socket.join(roomCode);
      socket.join(`host:${roomCode}`);
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

    // ── PLAYER: buzz in ──────────────────────────────────────────────────
    socket.on('buzz', () => {
      const info = socketPlayers.get(socket.id);
      if (!info) return;
      const won = gm.recordBuzz(info.roomCode, info.playerId, info.playerName);
      if (won) {
        io.to(info.roomCode).emit('buzz:winner', {
          playerId: info.playerId,
          playerName: info.playerName,
          timestamp: Date.now(),
        });
        io.to(info.roomCode).emit('game:state', gm.getSession(info.roomCode));
      } else {
        socket.emit('buzz:too-late');
      }
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
    socket.on('host:open-question', ({ roomCode, questionId, isDailyDouble }: { roomCode: string; questionId: string; isDailyDouble: boolean }) => {
      gm.openQuestion(roomCode, questionId, isDailyDouble);
      io.to(roomCode).emit('game:state', gm.getSession(roomCode));
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
    socket.on('host:score', ({ roomCode, playerId, delta }: { roomCode: string; playerId: string; delta: number }) => {
      gm.updateScore(roomCode, playerId, delta);
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
      if (info) {
        socketPlayers.delete(socket.id);
        // Don't auto-remove player on disconnect so they can reconnect
        const session = gm.getSession(info.roomCode);
        if (session) io.to(info.roomCode).emit('game:state', session);
      }
    });
  });
}
