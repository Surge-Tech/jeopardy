import { randomUUID } from 'node:crypto';
import { getCompetitor, wagerPlayerId } from '../../shared/competitors.js';
import type { DailyDoubleState } from '../../types.js';
import { sessions } from './state.js';

// ── Daily Double wagering ───────────────────────────────────────────────────

export function revealDailyDouble(roomCode: string, hasRecording = false): boolean {
  const session = sessions.get(roomCode);
  if (!session || session.phase === 'finished' || session.dailyDouble?.stage !== 'ready' || session.dailyDouble.wager == null || session.dailyDoubleRevealed) return false;
  session.dailyDoubleRevealed = true;
  session.clueRecordingId = hasRecording ? randomUUID() : null;
  return true;
}

export function setDailyDoubleTime(roomCode: string, seconds: number): boolean {
  const session = sessions.get(roomCode);
  if (!session || !Number.isInteger(seconds) || seconds < 0 || seconds > 300) return false;
  session.settings.dailyDoubleTimeS = seconds;
  return true;
}

export function startDailyDoubleTimer(roomCode: string): boolean {
  const session = sessions.get(roomCode);
  const dd = session?.dailyDouble;
  if (!session || session.phase !== 'playing' || !session.activeQuestionId || !dd ||
    dd.stage !== 'ready' || !session.dailyDoubleRevealed || session.responseVisible || dd.outcome || dd.timer) return false;
  const seconds = session.settings.dailyDoubleTimeS ?? 15;
  if (seconds <= 0) return false;
  const now = Date.now();
  dd.timer = { startedAt: now, deadline: now + seconds * 1000, serverNow: now };
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

  if (!lastCorrectPlayerId || !getCompetitor(session, lastCorrectPlayerId)) {
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

  const player = getCompetitor(session, lastCorrectPlayerId)!;
  session.dailyDouble = {
    stage: 'wagering',
    playerId: wagerPlayerId(session, player.id),
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
  if (!session || session.dailyDouble?.stage !== 'picking') return false;
  const player = getCompetitor(session, playerId);
  if (!player) return false;
  session.dailyDouble.playerId = wagerPlayerId(session, player.id);
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
  if (session.dailyDoubleRevealed) return { ok: false, error: 'The wager is locked after revealing the clue' };
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
