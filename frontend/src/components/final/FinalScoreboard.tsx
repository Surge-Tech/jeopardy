import { useEffect, useMemo } from 'react';
import type { GameState } from '../../types';
import { playWinnerFanfare } from '../../utils/sounds';

interface Row {
  playerId: string;
  name: string;
  color: string;
  preScore: number;
  wager: number | null;
  result: 'correct' | 'wrong' | null;
  change: number;
  finalScore: number;
  correct: number;
  wrong: number;
  buzzes: number;
  accuracy: number;
  rank: number;
}

export function buildRows(gameState: GameState): Row[] {
  const fj = gameState.finalJeopardy!;
  const withScore = fj.contestants.map(c => {
    const player = gameState.players.find(p => p.id === c.playerId);
    const revealed = fj.revealed[c.playerId];
    const change = revealed ? (revealed.correct ? revealed.wager : -revealed.wager) : 0;
    const correct = player?.stats?.correct ?? 0;
    const wrong = player?.stats?.wrong ?? 0;
    const total = correct + wrong;
    return {
      playerId: c.playerId,
      name: c.playerName,
      color: player?.color ?? '#FFD700',
      preScore: c.preScore,
      wager: revealed ? revealed.wager : null,
      result: revealed ? (revealed.correct ? 'correct' as const : 'wrong' as const) : null,
      change,
      finalScore: player?.score ?? c.preScore,
      correct,
      wrong,
      buzzes: player?.stats?.buzzes ?? 0,
      accuracy: total > 0 ? Math.round((correct / total) * 100) : 0,
      rank: 0,
    };
  });
  withScore.sort((a, b) => b.finalScore - a.finalScore);
  let rank = 0;
  let prevScore: number | null = null;
  withScore.forEach((r, i) => {
    if (prevScore === null || r.finalScore !== prevScore) rank = i + 1;
    r.rank = rank;
    prevScore = r.finalScore;
  });
  return withScore;
}

export default function FinalScoreboard({ gameState, compact }: { gameState: GameState; compact?: boolean }) {
  const rows = useMemo(() => buildRows(gameState), [gameState]);
  const top3 = rows.filter(r => r.rank <= 3).slice(0, 3);

  useEffect(() => { playWinnerFanfare(); }, []);

  if (compact) {
    const me = rows[0];
    return (
      <div className="text-center">
        <div className="text-jeopardy-gold font-black text-2xl mb-1">Final Standings</div>
        {rows.map(r => (
          <div key={r.playerId} className="flex justify-between text-sm py-1 border-b border-gray-800">
            <span>#{r.rank} {r.name}</span>
            <span className="text-jeopardy-gold font-bold">${r.finalScore}</span>
          </div>
        ))}
        {me && <div className="text-gray-400 text-xs mt-2">You finished #{me.rank}</div>}
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4">
      {/* Confetti for the winner */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {Array.from({ length: 60 }).map((_, i) => {
          const colors = ['#FFD700', '#4ade80', '#60a5fa', '#f87171', '#c084fc', '#fb923c'];
          const left = Math.random() * 100;
          const delay = Math.random() * 2;
          const duration = 3 + Math.random() * 2;
          return (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${left}%`,
                background: colors[i % colors.length],
                animationDelay: `${delay}s`,
                animationDuration: `${duration}s`,
              }}
            />
          );
        })}
      </div>

      <div className="text-center text-jeopardy-gold font-black text-4xl mb-6" style={{ textShadow: '3px 3px 0 #000' }}>
        FINAL SCOREBOARD
      </div>

      {/* Podium */}
      <div className="flex items-end justify-center gap-4 mb-8">
        {[top3[1], top3[0], top3[2]].map((r, i) => r && (
          <div key={r.playerId} className="podium-rise text-center" style={{ animationDelay: `${i * 0.15}s` }}>
            {r.rank === 1 && <div className="text-4xl mb-1">👑</div>}
            <div className="w-2 h-2 rounded-full mx-auto mb-1" style={{ background: r.color }} />
            <div className="font-bold text-white truncate max-w-[140px]">{r.name}</div>
            <div className="text-jeopardy-gold font-black text-xl mb-2">${r.finalScore}</div>
            <div
              className="bg-jeopardy-blue border-4 border-black flex items-center justify-center font-black text-jeopardy-gold"
              style={{ width: 140, height: r.rank === 1 ? 140 : r.rank === 2 ? 100 : 70 }}
            >
              #{r.rank}
            </div>
          </div>
        ))}
      </div>

      {/* Full stats table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-white">
          <thead>
            <tr className="text-gray-400 text-xs uppercase border-b border-gray-700">
              <th className="p-2 text-left">Rank</th>
              <th className="p-2 text-left">Player</th>
              <th className="p-2 text-right">Pre-FJ</th>
              <th className="p-2 text-right">Wager</th>
              <th className="p-2 text-center">Result</th>
              <th className="p-2 text-right">Change</th>
              <th className="p-2 text-right">Final</th>
              <th className="p-2 text-right">✓</th>
              <th className="p-2 text-right">✗</th>
              <th className="p-2 text-right">Acc%</th>
              <th className="p-2 text-right">Buzzes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.playerId} className="border-b border-gray-800">
                <td className="p-2">{r.rank}</td>
                <td className="p-2 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full inline-block" style={{ background: r.color }} />
                  {r.name}
                </td>
                <td className="p-2 text-right text-gray-400">${r.preScore}</td>
                <td className="p-2 text-right">{r.wager !== null ? `$${r.wager}` : '—'}</td>
                <td className="p-2 text-center">{r.result === 'correct' ? '✅' : r.result === 'wrong' ? '❌' : '—'}</td>
                <td className={`p-2 text-right ${r.change > 0 ? 'text-green-400' : r.change < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                  {r.change > 0 ? `+$${r.change}` : r.change < 0 ? `-$${Math.abs(r.change)}` : '$0'}
                </td>
                <td className="p-2 text-right font-black text-jeopardy-gold">${r.finalScore}</td>
                <td className="p-2 text-right text-green-400">{r.correct}</td>
                <td className="p-2 text-right text-red-400">{r.wrong}</td>
                <td className="p-2 text-right">{r.accuracy}%</td>
                <td className="p-2 text-right text-orange-300">{r.buzzes}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
