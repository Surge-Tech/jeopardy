export interface Question {
  id: string;
  value: number;
  clue: string;
  response: string;
  mediaType?: 'image' | 'video' | 'youtube';
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
  mediaType?: 'image' | 'video' | 'youtube';
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

export interface Player {
  id: string;
  name: string;
  score: number;
  color: string;
  stats?: PlayerStats;
}

export type FinalStage = 'intro' | 'wagering' | 'clue' | 'answering' | 'locked' | 'reveal' | 'response' | 'final';
export type FinalRevealStep = 'name' | 'wager' | 'answer' | 'judged';

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

export interface FinalPublicState {
  stage: FinalStage;
  category: string | null;
  clue: string | null;
  mediaType?: 'image' | 'video' | 'youtube';
  mediaUrl?: string;
  deadline: number | null;
  serverNow: number;
  contestants: FinalContestant[];
  revealIndex: number;
  revealStep: FinalRevealStep;
  currentReveal: { wager: number; answer: string } | null;
  revealed: Record<string, FinalRevealEntry>;
  response: string | null;
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

export const PERMANENT_LOCKOUT = Number.MAX_SAFE_INTEGER;

export interface GameState {
  boardId: string;
  roomCode: string;
  players: Player[];
  answeredQuestions: string[];
  activeQuestionId: string | null;
  buzzerState: 'idle' | 'open' | 'locked';
  buzzedPlayerId: string | null;
  buzzedPlayerName: string | null;
  buzzTimestamp: number | null;
  phase: 'lobby' | 'playing' | 'finished';
  dailyDoubleRevealed: boolean;
  responseVisible: boolean;
  finalJeopardy: FinalPublicState | null;
  dailyDouble: DailyDoubleState | null;
  lastCorrectPlayerId: string | null;
  buzzLockouts: Record<string, number>;
  buzzQueue: BuzzEntry[];
  settings: {
    lockoutMs: number;
    autoLockEnabled: boolean;
    autoLockTimeoutS: number;
  };
  currentRoundIndex: number;
}
