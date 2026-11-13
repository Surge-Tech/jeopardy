import { randomUUID } from 'node:crypto';
import { getCompetitor, getTeam, playerLabel } from '../../shared/competitors.js';
import { hasPendingAnswer } from '../../shared/questionFlow.js';
import type { GameState, Question } from '../../types.js';
import { sessions, resetBuzzerFields, pauseQuestionTimer, PERMANENT_LOCKOUT } from './state.js';

// ── Question lifecycle (buzzer-adjacent) ────────────────────────────────────

export function openQuestion(roomCode: string, questionId: string, isDailyDouble: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'playing' || session.finalJeopardy) return false;
  if (hasPendingAnswer(session) || session.dailyDouble) return false;
  session.activeQuestionId = questionId;
  session.clueVisible = false;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.dailyDoubleRevealed = !isDailyDouble; // Daily Double splash is separate from regular clue visibility
  session.responseVisible = false;
  return true;
}

export function revealClue(roomCode: string, mediaType?: Question['mediaType'], hasRecording = false, clueText = ''): boolean {
  const session = sessions.get(roomCode);
  if (!session?.activeQuestionId || session.clueVisible || session.dailyDouble || session.phase === 'finished') return false;
  session.clueVisible = true;
  if (hasRecording) {
    session.clueRecordingId = randomUUID();
  } else if ((mediaType === 'image' && !clueText.trim()) || mediaType === 'audio' || mediaType === 'video' || mediaType === 'youtube') {
    resetBuzzerFields(session, { buzzerState: 'open' });
  }
  return true;
}

export function finishClueRecording(roomCode: string, questionId: string, recordingId: string): boolean {
  const session = sessions.get(roomCode);
  if (!recordingId || !session || session.phase !== 'playing' || session.finalJeopardy || session.dailyDouble ||
      session.activeQuestionId !== questionId || session.clueRecordingId !== recordingId ||
      !session.clueVisible || session.responseVisible || session.buzzerState !== 'idle') return false;
  return enableBuzzer(roomCode);
}

export function showResponse(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (session.dailyDouble && (!session.dailyDoubleRevealed || !session.dailyDouble.outcome)) return false;
  session.responseVisible = true;
  session.clueRecordingId = null;
  session.answerTimer = null;
  pauseQuestionTimer(session);
  if (session.buzzerState === 'open') session.buzzerState = 'idle';
  return true;
}

export function closeQuestion(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  if (hasPendingAnswer(session)) return false;
  if (session.dailyDouble && session.dailyDoubleRevealed && !session.dailyDouble.outcome) return false;
  if (session.activeQuestionId) {
    session.answeredQuestions.push(session.activeQuestionId);
  }
  session.activeQuestionId = null;
  resetBuzzerFields(session, { buzzerState: 'idle', clearLockouts: true });
  session.clueVisible = false;
  session.dailyDoubleRevealed = false;
  session.responseVisible = false;
  session.dailyDouble = null;
  return true;
}

export function enableBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session?.activeQuestionId || session.phase === 'finished') return false;
  if (session.dailyDouble || !session.clueVisible || hasPendingAnswer(session)) return false;
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function resetBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session?.activeQuestionId || session.phase === 'finished') return false;
  if (session.dailyDouble || !session.clueVisible) return false;
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function lockBuzzer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  pauseQuestionTimer(session);
  session.clueRecordingId = null;
  session.buzzerState = 'idle';
  return true;
}

// ── Buzzing / lockout / history state machine ─────────────────────────────────

export const BUZZ_COLLECTION_MS = 500;

export type BuzzOutcome = 'won' | 'early' | 'locked-out' | 'ignored' | 'recorded';

export function setLobbyBuzzer(roomCode: string, action: 'open' | 'reset'): boolean {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'lobby' || (action !== 'open' && action !== 'reset')) return false;
  resetBuzzerFields(session, { buzzerState: action === 'open' ? 'open' : 'idle', clearLockouts: true });
  return true;
}

// Practice uses the regular first-buzz collection window, without a clue,
// answer timer, team eligibility requirements, scoring, or player statistics.
function recordLobbyBuzz(session: GameState, playerId: string, openedAt: number | null): BuzzOutcome {
  if (session.buzzerState === 'idle') return 'ignored';
  const now = Date.now();
  if (session.buzzHistory.some(entry => entry.playerId === playerId)) return 'ignored';
  if (session.buzzerState === 'locked' && (!session.buzzWindow || now >= session.buzzWindow.deadline)) return 'ignored';
  const playerName = playerLabel(session, playerId);
  const entry = { playerId, playerName, reactionMs: openedAt === null ? 0 : Math.max(0, now - openedAt), attemptedAnswer: false };
  session.buzzHistory.push(entry);
  if (session.buzzerState === 'locked') return 'recorded';
  session.buzzerState = 'locked';
  session.buzzedPlayerId = playerId;
  session.buzzedPlayerName = playerName;
  session.buzzTimestamp = now;
  session.buzzWindow = { deadline: now + BUZZ_COLLECTION_MS, serverNow: now };
  return 'won';
}

function startAnswerTimer(session: GameState, now: number) {
  session.answerTimer = !session.responseVisible && session.settings.answerTimeS > 0
    ? { deadline: now + session.settings.answerTimeS * 1000, serverNow: now }
    : null;
}

export function setAnswerTime(roomCode: string, seconds: number): boolean {
  const session = sessions.get(roomCode);
  if (!session || !Number.isInteger(seconds) || seconds < 0 || seconds > 120) return false;
  // Changes apply to the next contestant, preserving any answer in progress.
  session.settings.answerTimeS = seconds;
  return true;
}

export function recordBuzz(roomCode: string, playerId: string, playerName: string, buzzOpenedAt: number | null): BuzzOutcome {
  const session = sessions.get(roomCode);
  if (!session) return 'ignored';
  if (session.phase === 'lobby') {
    if (!session.players.some(player => player.id === playerId)) return 'ignored';
    return recordLobbyBuzz(session, playerId, buzzOpenedAt);
  }
  if (!session.activeQuestionId || session.phase === 'finished') return 'ignored';

  const now = Date.now();
  const player = session.players.find(p => p.id === playerId);
  if (!player || (session.mode === 'teams' && !getTeam(session, playerId)) || session.dailyDouble || session.finalJeopardy) return 'ignored';
  playerName = playerLabel(session, playerId);
  if (session.buzzLockouts[playerId] === PERMANENT_LOCKOUT) return 'locked-out';

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

  const lockedUntil = session.buzzLockouts[playerId];
  if (lockedUntil && now < lockedUntil) return 'locked-out';

  if (session.buzzerState === 'locked') {
    if (!session.buzzWindow || now >= session.buzzWindow.deadline) return 'ignored';
    // Record each player only once in the half-second collection window
    if (session.buzzHistory.some(e => e.playerId === playerId)) return 'ignored';
    // Late buzzes are feedback only; they never get an automatic turn.
    const reactionMs = buzzOpenedAt ? (now - buzzOpenedAt) : 0;
    session.buzzHistory.push({ playerId, playerName, reactionMs, attemptedAnswer: false });
    return 'recorded';
  }

  // buzzerState === 'open'
  const reactionMs = buzzOpenedAt ? (now - buzzOpenedAt) : 0;
  pauseQuestionTimer(session, now);
  session.buzzerState = 'locked';
  session.buzzedPlayerId = playerId;
  session.buzzedPlayerName = playerName;
  session.buzzTimestamp = now;
  session.buzzWindow = { deadline: now + BUZZ_COLLECTION_MS, serverNow: now };
  startAnswerTimer(session, now);
  session.buzzHistory.unshift({ playerId, playerName, reactionMs, attemptedAnswer: false });
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
  const player = session.players.find(p => p.id === playerId) ?? getCompetitor(session, playerId);
  if (!player) return false;
  if (session.dailyDouble?.playerId === playerId) {
    if (!validateScoreEligibility(roomCode, playerId, true)) return false;
    session.dailyDouble.outcome = outcome;
    session.dailyDouble.timer = null;
  }
  markBuzzAttempted(roomCode, playerId);
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

// Reject stale/duplicate/mismatched "Correct"/"Wrong" judging clicks: the
// awarded playerId must match whoever is actually eligible right now — the
// currently-buzzed-in player for a regular question, or the Daily Double
// contestant when isDailyDouble is true. Does not mutate state. Manual score
// adjustments (no outcome) bypass this check entirely — callers should only
// invoke it when an `outcome` is present.
export function validateScoreEligibility(roomCode: string, playerId: string, isDailyDouble: boolean): boolean {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'playing') return false;
  if (isDailyDouble) return playerId === session.dailyDouble?.playerId &&
    session.dailyDouble.stage === 'ready' && session.dailyDoubleRevealed && !session.dailyDouble.outcome;
  return playerId === session.buzzedPlayerId;
}

export function markWrongAndReopen(roomCode: string, playerId: string, delta: number): boolean {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'playing') return false;
  // Reject stale/duplicate/mismatched emits: only the currently-buzzed-in
  // player can be marked wrong. Does not mutate state on mismatch.
  if (playerId !== session.buzzedPlayerId) return false;
  const player = session.players.find(p => p.id === playerId);
  if (!player) return false;
  if (!updateScore(roomCode, playerId, delta)) return false;
  if (!player.stats) player.stats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0 };
  player.stats.wrong += 1;
  const team = getTeam(session, playerId);
  for (const member of session.players) {
    if (member.id === playerId || (team && member.teamId === team.id)) session.buzzLockouts[member.id] = PERMANENT_LOCKOUT;
  }
  markBuzzAttempted(roomCode, playerId);
  resetBuzzerFields(session, { buzzerState: 'open' });
  return true;
}

export function markBuzzAttempted(roomCode: string, playerId: string): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const entry = session.buzzHistory.find(e => e.playerId === playerId);
  if (entry) entry.attemptedAnswer = true;
  if (session.buzzedPlayerId === playerId) session.answerTimer = null;
  return true;
}

// The window identity prevents an old callback from closing a newly reopened buzzer.
export function finishBuzzCollection(roomCode: string, window: GameState['buzzWindow']): boolean {
  const session = sessions.get(roomCode);
  if (!window || session?.buzzWindow !== window) return false;
  session.buzzWindow = null;
  return true;
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export function updateScore(roomCode: string, playerId: string, delta: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = getCompetitor(session, playerId);
  if (!player || !Number.isFinite(delta) || !Number.isInteger(delta)) return false;
  player.score += delta;
  return true;
}

export function setScore(roomCode: string, playerId: string, score: number): boolean {
  const session = sessions.get(roomCode);
  if (!session) return false;
  const player = getCompetitor(session, playerId);
  if (!player || !Number.isFinite(score) || !Number.isInteger(score)) return false;
  player.score = score;
  return true;
}
