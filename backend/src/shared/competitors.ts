import type { GameState, Player, PlayerStats, Team } from './types.js';

export function getTeam(state: GameState, playerId: string): Team | undefined {
  const player = state.players.find(p => p.id === playerId);
  return state.mode === 'teams' ? state.teams.find(t => t.id === player?.teamId) : undefined;
}

// Accept competitor IDs for host controls and player IDs for buzzer-driven scoring.
export function getCompetitor(state: GameState, id: string): Player | Team | undefined {
  if (state.mode === 'teams') return state.teams.find(t => t.id === id) ?? getTeam(state, id);
  return state.players.find(p => p.id === id);
}

export function getCompetitors(state: GameState): Player[] {
  if (state.mode !== 'teams') return state.players;
  return state.teams.map(team => {
    const stats: PlayerStats = { correct: 0, wrong: 0, buzzes: 0, earlyBuzzes: 0, ...team.stats };
    for (const player of state.players.filter(p => p.teamId === team.id)) {
      for (const key of Object.keys(stats) as (keyof PlayerStats)[]) stats[key] += player.stats?.[key] ?? 0;
    }
    return { ...team, stats };
  });
}

export function playerLabel(state: GameState, playerId: string): string {
  const player = state.players.find(p => p.id === playerId);
  const team = getTeam(state, playerId);
  return team ? `${player?.name} · ${team.name}` : player?.name ?? '';
}

export function wagerPlayerId(state: GameState, id: string): string | null {
  const competitor = getCompetitor(state, id);
  if (!competitor) return null;
  return state.mode === 'teams' ? (competitor as Team).captainPlayerId : competitor.id;
}
