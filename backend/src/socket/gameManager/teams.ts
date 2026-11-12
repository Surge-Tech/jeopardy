import { randomInt, randomUUID } from 'crypto';
import { sessions } from './state.js';
import { LIMITS } from '../../shared/limits.js';
import { hasPendingAnswer } from '../../shared/questionFlow.js';

type Result = { ok: boolean; error?: string };
const fail = (error: string): Result => ({ ok: false, error });

export function setMode(roomCode: string, mode: 'individual' | 'teams'): Result {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'lobby') return fail('Game mode can only change in the lobby');
  if (mode !== 'individual' && mode !== 'teams') return fail('Invalid game mode');
  session.mode = mode;
  return { ok: true };
}

export function saveTeam(roomCode: string, id: string | undefined, name: string, color: string): Result {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'lobby') return fail('Teams can only change in the lobby');
  if (typeof name !== 'string' || !name.trim()) return fail('Enter a team name');
  const trimmed = name.trim().slice(0, LIMITS.PLAYER_NAME_MAX);
  if (session.teams.some(t => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase())) return fail('Team name already taken');
  if (!/^#[0-9a-f]{6}$/i.test(color)) return fail('Choose a valid team color');
  if (id) {
    const team = session.teams.find(t => t.id === id);
    if (!team) return fail('Team not found');
    team.name = trimmed;
    team.color = color;
  } else session.teams.push({ id: randomUUID(), name: trimmed, color, score: 0, captainPlayerId: null });
  return { ok: true };
}

export function removeTeam(roomCode: string, teamId: string): Result {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'lobby') return fail('Teams can only change in the lobby');
  if (!session.teams.some(t => t.id === teamId)) return fail('Team not found');
  session.teams = session.teams.filter(t => t.id !== teamId);
  for (const player of session.players) if (player.teamId === teamId) player.teamId = null;
  return { ok: true };
}

export function assignTeam(roomCode: string, playerId: string, teamId: string | null): Result {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'lobby') return fail('Membership can only change in the lobby');
  const player = session.players.find(p => p.id === playerId);
  const team = session.teams.find(t => t.id === teamId);
  if (!player || (teamId !== null && !team)) return fail('Player or team not found');
  for (const old of session.teams) if (old.id !== teamId && old.captainPlayerId === playerId) old.captainPlayerId = null;
  player.teamId = teamId;
  if (team && !team.captainPlayerId) team.captainPlayerId = playerId;
  return { ok: true };
}

export function autoAssignTeams(roomCode: string): Result {
  const session = sessions.get(roomCode);
  if (!session || session.phase !== 'lobby') return fail('Membership can only change in the lobby');
  if (session.mode !== 'teams') return fail('Select team mode first');
  if (session.teams.length < 2) return fail('Create at least two teams first');
  if (session.players.length < session.teams.length) return fail('Each team needs at least one player');

  // Shuffle a copy so reconnect identities and player join order remain stable.
  const players = [...session.players];
  for (let i = players.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [players[i], players[j]] = [players[j], players[i]];
  }
  for (const team of session.teams) team.captainPlayerId = null;
  players.forEach((player, index) => {
    const team = session.teams[index % session.teams.length];
    player.teamId = team.id;
    if (!team.captainPlayerId) team.captainPlayerId = player.id;
  });
  return { ok: true };
}

export function setCaptain(roomCode: string, teamId: string, playerId: string): Result {
  const session = sessions.get(roomCode);
  if (!session || session.phase === 'finished') return fail('Game is not available');
  // Wagering and Final Jeopardy allow a disconnected captain to be replaced.
  if (hasPendingAnswer(session) || (session.activeQuestionId && session.dailyDouble?.stage !== 'wagering')) return fail('Change captains between clues');
  const team = session.teams.find(t => t.id === teamId);
  if (!team || !session.players.some(p => p.id === playerId && p.teamId === teamId)) return fail('Captain must be a team member');
  team.captainPlayerId = playerId;
  if (session.dailyDouble?.playerId && session.players.some(p => p.id === session.dailyDouble?.playerId && p.teamId === teamId)) {
    session.dailyDouble.playerId = playerId;
  }
  return { ok: true };
}
