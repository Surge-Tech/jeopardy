import { randomUUID as uuidv4 } from 'crypto';
import type { GameState, Player } from '../types.js';

const sessions = new Map<string, GameState>();

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

export function createSession(boardId: string): GameState {
  let roomCode = generateRoomCode();
  while (sessions.has(roomCode)) roomCode = generateRoomCode();

  const state: GameState = {
    boardId,
    roomCode,
    players: [],
    answeredQuestions: [],
    activeQuestionId: null,
    buzzerState: 'idle',
    buzzedPlayerId: null,
    buzzedPlayerName: null,
    buzzTimestamp: null,
    phase: 'lobby',
    dailyDoubleRevealed: false,
    responseVisible: false,
  };
  sessions.set(roomCode, state);
  return state;
}

export function getSession(roomCode: string): GameState | undefined {
  return sessions.get(roomCode);
}

export function deleteSession(roomCode: string) {
  sessions.delete(roomCode);
}

export function addPlayer(roomCode: string, name: string, color: string): Player | null {
  const session = sessions.get(roomCode);
  if (!session) return null;
  const player: Player = { id: uuidv4(), name, score: 0, color };
  session.players.push(player);
  return player;
}

export function removePlayer(roomCode: string, playerId: string) {
  const session = sessions.get(roomCode);
  if (!session) return;
  session.players = session.players.filter(p => p.id !== playerId);
}

export function updateScore(roomCode: string, playerId: string, delta: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  player.score += delta;
  return true;
}

export function setScore(roomCode: string, playerId: string, score: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  player.score = score;
  return true;
}

export function openQuestion(roomCode: string, questionId: string, isDailyDouble: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.activeQuestionId = questionId;
  session.buzzerState = 'idle';
  session.buzzedPlayerId = null;
  session.buzzedPlayerName = null;
  session.buzzTimestamp = null;
  session.dailyDoubleRevealed = !isDailyDouble; // DD starts unrevealed; regular questions start revealed
  session.responseVisible = false;
  return true;
}

export function revealDailyDouble(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.dailyDoubleRevealed = true;
  return true;
}

export function showResponse(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.responseVisible = true;
  return true;
}

export function closeQuestion(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (session.activeQuestionId) {
    session.answeredQuestions.push(session.activeQuestionId);
  }
  session.activeQuestionId = null;
  session.buzzerState = 'idle';
  session.buzzedPlayerId = null;
  session.buzzedPlayerName = null;
  session.buzzTimestamp = null;
  session.dailyDoubleRevealed = false;
  session.responseVisible = false;
  return true;
}

export function enableBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'open';
  session.buzzedPlayerId = null;
  session.buzzedPlayerName = null;
  session.buzzTimestamp = null;
  return true;
}

export function resetBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'open';
  session.buzzedPlayerId = null;
  session.buzzedPlayerName = null;
  session.buzzTimestamp = null;
  return true;
}

export function lockBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'idle';
  return true;
}

export function recordBuzz(roomCode: string, playerId: string, playerName: string): boolean {
  const session = sessions.get(roomCode);
  if (!session || session.buzzerState !== 'open') return false;
  session.buzzerState = 'locked';
  session.buzzedPlayerId = playerId;
  session.buzzedPlayerName = playerName;
  session.buzzTimestamp = Date.now();
  return true;
}

export function startGame(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.phase = 'playing';
  return true;
}

export function listSessions(): { roomCode: string; boardId: string; playerCount: number; phase: string }[] {
  return Array.from(sessions.entries()).map(([roomCode, s]) => ({
    roomCode,
    boardId: s.boardId,
    playerCount: s.players.length,
    phase: s.phase,
  }));
}
