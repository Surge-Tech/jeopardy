import { randomUUID as uuidv4 } from 'crypto';
import type { GameState, Player, FinalPublicState, DailyDoubleState, BuzzEntry } from '../types.js';

export const PERMANENT_LOCKOUT = Number.MAX_SAFE_INTEGER;

const sessions = new Map<string, GameState>();

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

// Resets the buzzer-related fields shared by every "start fresh" transition
// (openQuestion, closeQuestion, resetBuzzer, enableBuzzer, advanceRound,
// endGame). Callers that need to reset additional fields (dailyDoubleRevealed,
// responseVisible, dailyDouble, buzzLockouts, etc.) do so inline after calling
// this helper — see each call site for the exact variation.
function resetBuzzerFields(
  session: GameState,
  opts: { buzzerState: 'idle' | 'open'; clearLockouts?: boolean }
) {
  session.buzzerState = opts.buzzerState;
  session.buzzedPlayerId = null;
  session.buzzedPlayerName = null;
  session.buzzTimestamp = null;
  session.buzzQueue = [];
  if (opts.clearLockouts) session.buzzLockouts = {};
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
    finalJeopardy: null,
    dailyDouble: null,
    lastCorrectPlayerId: null,
    buzzLockouts: {},
    buzzQueue: [],
    settings: { lockoutMs: 250, autoLockEnabled: true, autoLockTimeoutS: 7 },
    currentRoundIndex: 0,
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

// Case-insensitive, trimmed name-uniqueness check within a session. Excludes
// `excludePlayerId` so a rename can keep a player's own current name.
export function isNameTaken(session: GameState, name: string, excludePlayerId?: string): boolean {
  const normalized = name.trim().toLowerCase();
  return session.players.some(p => p.id !== excludePlayerId && p.name.trim().toLowerCase() === normalized);
}

export function addPlayer(roomCode: string, name: string, color: string): Player | null {
  const session = sessions.get(roomCode);
  if (!session) return null;
  if (isNameTaken(session, name)) return null;
  const player: Player = { id: uuidv4(), name, score: 0, color };
  session.players.push(player);
  return player;
}

export function removePlayer(roomCode: string, playerId: string) {
  const session = sessions.get(roomCode);
  if (!session) return;
  session.players = session.players.filter(p => p.id !== playerId);
}

export function renamePlayer(roomCode: string, playerId: string, newName: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  if (isNameTaken(session, newName, playerId)) return false;
  player.name = newName.trim().slice(0, 32);
  return true;
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
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
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
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDoubleRevealed = false;
  session.responseVisible = false;
  session.dailyDouble = null;
  return true;
}

export function enableBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function resetBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function lockBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'idle';
  return true;
}

export type BuzzOutcome = 'won' | 'early' | 'locked-out' | 'ignored' | 'queued';

export function recordBuzz(roomCode: string, playerId: string, playerName: string, buzzOpenedAt: number | null): BuzzOutcome {
  const session = sessions.get(roomCode);
  if (!session) return 'ignored';
  if (!session.activeQuestionId || session.phase === 'finished') return 'ignored';

  const now = Date.now();
  const player = session.players.find(p => p.id === playerId);

  if (session.buzzerState === 'idle') {
    if (session.settings.lockoutMs > 0) {
      session.buzzLockouts[playerId] = now + session.settings.lockoutMs;
      if (player) {
        if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
        player.stats.earlyBuzzes += 1;
      }
    }
    return 'early';
  }

  if (session.buzzerState === 'locked') {
    // Player already in queue
    if (session.buzzQueue.some(e => e.playerId === playerId)) return 'ignored';
    // Player permanently locked out
    if (session.buzzLockouts[playerId] === PERMANENT_LOCKOUT) return 'ignored';
    // Queue the buzz
    const reactionMs = buzzOpenedAt ? (now - buzzOpenedAt) : 0;
    session.buzzQueue.push({ playerId, playerName, reactionMs, attemptedAnswer: false });
    session.buzzQueue.sort((a, b) => a.reactionMs - b.reactionMs);
    return 'queued';
  }

  // buzzerState === 'open'
  const lockedUntil = session.buzzLockouts[playerId];
  if (lockedUntil && now < lockedUntil) {
    return 'locked-out';
  }

  const reactionMs = buzzOpenedAt ? (now - buzzOpenedAt) : 0;
  session.buzzerState = 'locked';
  session.buzzedPlayerId = playerId;
  session.buzzedPlayerName = playerName;
  session.buzzTimestamp = now;
  session.buzzQueue.unshift({ playerId, playerName, reactionMs, attemptedAnswer: false });
  if (player) {
    if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
    player.stats.buzzes += 1;
  }
  return 'won';
}

// Records a correct/wrong outcome against a player's stats (score delta is applied separately via updateScore).
export function recordOutcome(roomCode: string, playerId: string, outcome: 'correct' | 'wrong'): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
  if (outcome === 'correct') player.stats.correct += 1;
  else player.stats.wrong += 1;
  return true;
}

const VALID_LOCKOUTS = [0, 250, 500, 1000];

export function setLockoutMs(roomCode: string, ms: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (!VALID_LOCKOUTS.includes(ms)) return false;
  session.settings.lockoutMs = ms;
  return true;
}

// Get/set the public Final Jeopardy sub-state on a session (used by finalJeopardy.ts).
export function getFinalState(roomCode: string): FinalPublicState | null | undefined {
  const session = sessions.get(roomCode);
  return session?.finalJeopardy;
}

export function setFinalState(roomCode: string, fj: FinalPublicState | null): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.finalJeopardy = fj;
  return true;
}

// ── Daily Double wagering ───────────────────────────────────────────────────

export function setLastCorrectPlayer(roomCode: string, playerId: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.lastCorrectPlayerId = playerId;
  return true;
}

// Begin the wager step for a newly-opened Daily Double. If no player has
// correctly answered a regular question yet, falls into 'picking' so the
// host can choose the contestant manually.
export function startDailyDoubleWager(
  roomCode: string,
  lastCorrectPlayerId: string | null,
  boardHighValue: number,
  hasDevice: boolean,
): DailyDoubleState | null {
  const session = sessions.get(roomCode);
  if (!session) return null;

  if (!lastCorrectPlayerId || !session.players.some(p => p.id === lastCorrectPlayerId)) {
    session.dailyDouble = {
      stage: 'picking',
      playerId: null,
      maxWager: 0,
      boardHighValue,
      wager: null,
      hasDevice: false,
      submittedByPlayer: false,
    };
    return session.dailyDouble;
  }

  const player = session.players.find(p => p.id === lastCorrectPlayerId)!;
  session.dailyDouble = {
    stage: 'wagering',
    playerId: player.id,
    maxWager: Math.max(player.score, boardHighValue),
    boardHighValue,
    wager: null,
    hasDevice,
    submittedByPlayer: false,
  };
  return session.dailyDouble;
}

// Host's fallback pick when there's no tracked "last correct" player.
export function pickDDContestant(roomCode: string, playerId: string, hasDevice: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session || !session.dailyDouble) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  session.dailyDouble.playerId = player.id;
  session.dailyDouble.maxWager = Math.max(player.score, session.dailyDouble.boardHighValue);
  session.dailyDouble.hasDevice = hasDevice;
  session.dailyDouble.stage = 'wagering';
  return true;
}

export function submitDDWager(roomCode: string, playerId: string, amount: number): { ok: boolean; error?: string } {
  const session = sessions.get(roomCode);
  const dd = session?.dailyDouble;
  if (!session || !dd) return { ok: false, error: 'No Daily Double in progress' };
  if (dd.stage !== 'wagering') return { ok: false, error: 'Wagering is closed' };
  if (dd.playerId !== playerId) return { ok: false, error: 'You are not the Daily Double contestant' };
  if (dd.submittedByPlayer) return { ok: false, error: 'Wager already locked' };
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > dd.maxWager) {
    return { ok: false, error: `Wager must be a whole number between 0 and ${dd.maxWager}` };
  }
  dd.wager = amount;
  dd.submittedByPlayer = true;
  dd.stage = 'ready';
  return { ok: true };
}

// Host correcting/entering the wager. Only allowed once the player has
// submitted (so this is a fix-up, not a bypass) — unless the assigned
// player has no phone connected, in which case this IS their only path in.
export function overrideDDWager(roomCode: string, amount: number): { ok: boolean; error?: string } {
  const session = sessions.get(roomCode);
  const dd = session?.dailyDouble;
  if (!session || !dd || !dd.playerId) return { ok: false, error: 'No Daily Double contestant assigned' };
  if (dd.hasDevice && !dd.submittedByPlayer) {
    return { ok: false, error: "Waiting for the player's own wager first" };
  }
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0 || amount > dd.maxWager) {
    return { ok: false, error: `Wager must be a whole number between 0 and ${dd.maxWager}` };
  }
  dd.wager = amount;
  dd.stage = 'ready';
  return { ok: true };
}

export function clearDailyDouble(roomCode: string): void {
  const session = sessions.get(roomCode);
  if (session) session.dailyDouble = null;
}

export function startGame(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.phase = 'playing';
  return true;
}

// Advances to the next round. Rejects if a question/DD/FJ is active or this
// is already the last round. Players, scores, stats and lastCorrectPlayerId
// all carry over — only the per-question/buzzer/lockout state resets.
export function advanceRound(roomCode: string, roundCount: number): { ok: boolean; error?: string } {
  const session = sessions.get(roomCode);
  if (!session) return { ok: false, error: 'Room not found' };
  if (session.activeQuestionId) return { ok: false, error: 'A question is still active' };
  if (session.finalJeopardy) return { ok: false, error: 'Final Jeopardy is in progress' };
  if (session.currentRoundIndex >= roundCount - 1) return { ok: false, error: 'Already on the last round' };

  session.currentRoundIndex += 1;
  session.activeQuestionId = null;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDoubleRevealed = false;
  session.responseVisible = false;
  session.dailyDouble = null;
  return { ok: true };
}

export function endGame(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.phase = 'finished';
  session.activeQuestionId = null;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDouble = null;
  return true;
}

export function resumeGame(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.phase = 'playing';
  return true;
}

// Reject stale/duplicate/mismatched "Correct"/"Wrong" judging clicks: the
// awarded playerId must match whoever is actually eligible right now — the
// currently-buzzed-in player for a regular question, or the Daily Double
// contestant when isDailyDouble is true. Does not mutate state. Manual score
// adjustments (no outcome) bypass this check entirely — callers should only
// invoke it when an `outcome` is present.
export function validateScoreEligibility(roomCode: string, playerId: string, isDailyDouble: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (isDailyDouble) return playerId === session.dailyDouble?.playerId;
  return playerId === session.buzzedPlayerId;
}

export function markWrongAndReopen(roomCode: string, playerId: string, delta: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  // Reject stale/duplicate/mismatched emits: only the currently-buzzed-in
  // player can be marked wrong. Does not mutate state on mismatch.
  if (playerId !== session.buzzedPlayerId) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  player.score += delta;
  if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
  player.stats.wrong += 1;
  session.buzzLockouts[playerId] = PERMANENT_LOCKOUT;
  // Does NOT touch buzzerState, buzzedPlayerId, buzzedPlayerName, buzzTimestamp
  return true;
}

export function markBuzzAttempted(roomCode: string, playerId: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const entry = session.buzzQueue.find(e => e.playerId === playerId);
  if (entry) entry.attemptedAnswer = true;
  return true;
}

export function getNextInQueue(roomCode: string, ineligibleIds: Set<string>): BuzzEntry | null {
  const session = sessions.get(roomCode);
  if (!session) return null;
  return session.buzzQueue.find(e => !e.attemptedAnswer && !ineligibleIds.has(e.playerId)) ?? null;
}

export function advanceToBuzzEntry(roomCode: string, entry: BuzzEntry): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.buzzerState = 'locked';
  session.buzzedPlayerId = entry.playerId;
  session.buzzedPlayerName = entry.playerName;
  session.buzzTimestamp = Date.now();
  return true;
}

export function setAutoLock(roomCode: string, enabled: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  session.settings.autoLockEnabled = enabled;
  return true;
}

export function setAutoLockTimeout(roomCode: string, seconds: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 10) return false;
  session.settings.autoLockTimeoutS = seconds;
  return true;
}
