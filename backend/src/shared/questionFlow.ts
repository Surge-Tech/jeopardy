import type { GameState } from './types.js';

export function hasPendingAnswer(state: Pick<GameState, 'buzzedPlayerId' | 'buzzQueue'>): boolean {
  return !!state.buzzedPlayerId && !state.buzzQueue.find(
    entry => entry.playerId === state.buzzedPlayerId,
  )?.attemptedAnswer;
}
