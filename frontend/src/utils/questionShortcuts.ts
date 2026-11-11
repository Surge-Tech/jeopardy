import { hasPendingAnswer } from '@shared/questionFlow';
import type { GameState } from '@shared/types';

// Called only for an active regular question, after excluding typing and repeats.
export function getQuestionShortcut(
  event: Pick<KeyboardEvent, 'code' | 'key'>,
  state: Pick<GameState, 'clueVisible' | 'responseVisible' | 'buzzerState' | 'buzzedPlayerId' | 'buzzQueue'>,
): 'reveal' | 'open' | 'response' | 'close' | null {
  if (event.code === 'Space' || event.key === ' ') {
    if (state.responseVisible) return hasPendingAnswer(state) ? null : 'close';
    if (!state.clueVisible) return 'reveal';
    if (state.buzzerState === 'idle') return 'open';
  } else if (event.key.toLowerCase() === 'r' && state.clueVisible && !state.responseVisible) {
    return 'response';
  }
  return null;
}
