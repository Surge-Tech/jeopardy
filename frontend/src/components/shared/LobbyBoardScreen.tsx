import type { GameState, Player } from '@shared/types';
import PlayerJoinCode from './PlayerJoinCode';
import BoardBuzzerDock from './BoardBuzzerDock';

export default function LobbyBoardScreen({ gameState, boardName }: { gameState: GameState; boardName: string }) {
  const teamsMode = gameState.mode === 'teams';
  const testing = gameState.buzzerState !== 'idle' || gameState.buzzHistory.length > 0;
  const unassigned = gameState.players.filter(player => !gameState.teams.some(team => team.id === player.teamId));
  function roster(players: Player[], captainId?: string | null) {
    return <ul className="grid sm:grid-cols-2 gap-3">
      {players.map(player => <li key={player.id} className="rounded-xl bg-white/5 px-4 py-3 flex items-center gap-3 min-w-0">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: player.color }} />
        <span className="text-xl break-words min-w-0">{player.name}</span>
        {player.id === captainId && <span className="text-xs text-jeopardy-gold ml-auto">Captain</span>}
      </li>)}
    </ul>;
  }
  return <main className={`min-h-screen bg-jeopardy-dark text-white p-6 pt-24 md:p-10 md:pt-20${testing ? ' lobby-board--testing' : ''}`}>
    <header className="text-center mb-8">
      <p className="text-jeopardy-gold uppercase tracking-widest font-bold mb-2">Game lobby · {teamsMode ? 'Team mode' : 'Individual mode'}</p>
      <h1 className="text-3xl md:text-5xl font-black break-words">{boardName}</h1>
    </header>
    <div className="max-w-7xl mx-auto grid lg:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.3fr)] gap-8 lg:gap-12 items-start">
      <div className="rounded-2xl bg-black/20 border border-white/10 p-6"><PlayerJoinCode roomCode={gameState.roomCode} /></div>
      <section aria-label="Lobby players" className="space-y-5">
        <h2 className="text-2xl font-bold text-jeopardy-gold">{gameState.players.length} {gameState.players.length === 1 ? 'player' : 'players'} joined{teamsMode ? ` · ${gameState.teams.length} teams` : ''}</h2>
        {gameState.players.length === 0 && <p className="text-xl text-gray-300">Scan to join—players will appear here.</p>}
        {teamsMode ? <>
          {gameState.teams.map(team => <section key={team.id} className="rounded-xl bg-black/20 border-l-4 p-4 space-y-3" style={{ borderColor: team.color }}>
            <h3 className="text-2xl font-bold break-words">{team.name}</h3>
            {roster(gameState.players.filter(player => player.teamId === team.id), team.captainPlayerId)}
            {!gameState.players.some(player => player.teamId === team.id) && <p className="text-gray-400">Waiting for players</p>}
          </section>)}
          {unassigned.length > 0 && <section className="space-y-3"><h3 className="text-xl font-bold text-gray-300">Awaiting team assignment</h3>{roster(unassigned)}</section>}
        </> : roster(gameState.players)}
      </section>
    </div>
    {testing && <BoardBuzzerDock gameState={gameState} />}
  </main>;
}
