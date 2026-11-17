import type { GameState } from './types.js';

// Shared by the host's readiness display and the authoritative start action.
export function getStartGameError(state: Pick<GameState, 'phase' | 'mode' | 'players' | 'teams'>): string | null {
  if (state.phase !== 'lobby') return 'The game is no longer in the lobby';
  if (!state.players.length) return 'Add at least one player before starting';
  if (state.mode === 'teams') {
    if (!state.teams.length) return 'Create a team before starting';
    if (state.players.some(player => !state.teams.some(team => team.id === player.teamId))) {
      return 'Assign every player to a team before starting';
    }
    if (state.teams.some(team => !state.players.some(player => player.teamId === team.id && player.id === team.captainPlayerId))) {
      return 'Choose a captain for each team before starting';
    }
  }
  return null;
}
