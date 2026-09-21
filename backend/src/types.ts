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

export interface Board {
  id: string;
  name: string;
  categories: Category[];
  pointValues: number[];
  createdAt: string;
  updatedAt: string;
}

export interface Player {
  id: string;
  name: string;
  score: number;
  color: string;
}

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
  dailyDoubleRevealed: boolean;  // false until host clicks "Reveal Question"
  responseVisible: boolean;       // true after host clicks "Show Answer"
}

export interface BuzzerPlayer {
  playerId: string;
  playerName: string;
  socketId: string;
}
