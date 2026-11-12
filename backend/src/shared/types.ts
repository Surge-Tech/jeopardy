// Canonical shared type definitions for the Jeopardy game, used by both the
// backend (imports directly) and the frontend (imports via the @shared alias,
// see frontend/vite.config.ts and frontend/tsconfig.json).
//
// This file lives inside backend/src so the backend's existing tsc build
// config (rootDir: "src", outDir: "dist") requires no changes. Do not import
// anything backend-specific from here — it must stay safely importable from
// the frontend too.

export interface Question {
  id: string;
  value: number;
  clue: string;
  response: string;
  responseMediaType?: 'image' | 'video' | 'audio' | 'youtube';
  responseMediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'youtube';
  mediaUrl?: string;
  isDailyDouble?: boolean;
}

export interface Category {
  id: string;
  name: string;
  questions: Question[];
}

export interface FinalJeopardyBoard {
  category: string;
  clue: string;
  response: string;
  responseMediaType?: 'image' | 'video' | 'audio' | 'youtube';
  responseMediaUrl?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'youtube';
  mediaUrl?: string;
  timerSeconds?: number;
}

export interface Round {
  id: string;
  name?: string;
  categories: Category[];
  pointValues: number[];
}
export interface Board {
  id: string;
  name: string;
  rounds: Round[];
  createdAt: string;
  updatedAt: string;
  finalJeopardy?: FinalJeopardyBoard;
}

export interface PlayerStats {
  correct: number;
  wrong: number;
  buzzes: number;
  earlyBuzzes: number;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  score: number;
  captainPlayerId: string | null;
  // Team-level Final Jeopardy outcomes; ordinary clue stats remain on members.
  stats?: PlayerStats;
}

export interface Player {
  teamId?: string | null;
  id: string;
  name: string;
  score: number;
  color: string;
  stats?: PlayerStats;
}

export type FinalStage = 'intro' | 'wagering' | 'clue' | 'answering' | 'locked' | 'reveal' | 'response' | 'final';
export type FinalRevealStep = 'name' | 'wager' | 'answer' | 'judged';

// playerId is the competitor ID: a player in individual mode, a team in team mode.
export interface FinalContestant {
  playerId: string;
  playerName: string;
  maxWager: number;
  hasWagered: boolean;
  hasAnswered: boolean;
  preScore: number;
}

export interface FinalRevealEntry {
  wager: number;
  answer: string;
  correct: boolean | null;
}

// Public Final Jeopardy state — broadcast to every client via game:state.
// Secrets (wagers/answers before reveal, timers) live server-side only, in finalJeopardy.ts.
export interface FinalPublicState {
  stage: FinalStage;
  category: string | null;
  clue: string | null;
  mediaType?: 'image' | 'video' | 'audio' | 'youtube';
  mediaUrl?: string;
  deadline: number | null;
  serverNow: number;
  contestants: FinalContestant[];
  revealIndex: number;
  revealStep: FinalRevealStep;
  currentReveal: { wager: number; answer: string } | null;
  revealed: Record<string, FinalRevealEntry>;
  response: string | null;
  responseMediaType?: 'image' | 'video' | 'audio' | 'youtube';
  responseMediaUrl?: string;
}

export interface DailyDoubleState {
  stage: 'picking' | 'wagering' | 'ready';
  playerId: string | null;
  maxWager: number;
  boardHighValue: number;
  wager: number | null;
  hasDevice: boolean;
  submittedByPlayer: boolean;
}

export interface BuzzEntry {
  playerId: string;
  playerName: string;
  reactionMs: number;
  attemptedAnswer: boolean;
}

// Sentinel value used in GameState.buzzLockouts to mark a player as
// permanently locked out of buzzing for the current question (as opposed to
// a timed lockout, which stores a future timestamp).
export const PERMANENT_LOCKOUT = Number.MAX_SAFE_INTEGER;

export interface GameState {
  mode: 'individual' | 'teams';
  teams: Team[];
  boardId: string;
  roomCode: string;
  players: Player[];
  answeredQuestions: string[];
  activeQuestionId: string | null;
  buzzerState: 'idle' | 'open' | 'locked';
  buzzedPlayerId: string | null;
  buzzedPlayerName: string | null;
  buzzTimestamp: number | null;
  answerTimer: { deadline: number; serverNow: number } | null;
  phase: 'lobby' | 'playing' | 'finished';
  clueVisible: boolean;  // regular clue explicitly revealed by host
  dailyDoubleRevealed: boolean;  // false until host clicks "Reveal Question"
  responseVisible: boolean;       // true after host clicks "Show Answer"
  finalJeopardy: FinalPublicState | null;
  dailyDouble: DailyDoubleState | null;
  lastCorrectPlayerId: string | null;
  buzzLockouts: Record<string, number>;
  // Results for the current buzz attempt; never used to assign the next turn.
  buzzHistory: BuzzEntry[];
  buzzWindow: { deadline: number; serverNow: number } | null;
  settings: {
    lockoutMs: number;
    answerTimeS: number; // 0 disables the answer countdown
  };
  currentRoundIndex: number;
}
