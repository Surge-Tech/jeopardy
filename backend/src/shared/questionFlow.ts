import type { GameState } from './types.js';

export function hasPendingAnswer(state: Pick<GameState, 'buzzedPlayerId' | 'buzzHistory'>): boolean {
  return !!state.buzzedPlayerId && !state.buzzHistory.find(
    entry => entry.playerId === state.buzzedPlayerId,
  )?.attemptedAnswer;
}
