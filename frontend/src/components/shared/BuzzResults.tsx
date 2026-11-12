import type { BuzzEntry } from '@shared/types';

export default function BuzzResults({ entries, winnerId, myId }: {
  entries: BuzzEntry[];
  winnerId: string | null;
  myId?: string;
}) {
  if (!entries?.length) return null;
  return (
    <section className="w-full rounded-lg border border-gray-600 bg-gray-900 p-3 text-sm" aria-label="Buzz order">
      <div className="text-xs text-gray-400 uppercase mb-2">Buzz order</div>
      <ol className="space-y-1">
        {entries.map((entry, index) => (
          <li key={entry.playerId} className={`flex items-center gap-2 ${entry.playerId === winnerId ? 'text-yellow-400 font-bold' : 'text-gray-300'}`}>
            <span className="text-gray-500">{index + 1}.</span>
            <span className="min-w-0 flex-1 break-words">{entry.playerName}{entry.playerId === myId ? ' (you)' : ''}</span>
            <span className="text-xs whitespace-nowrap">{entry.playerId === winnerId ? 'First' : 'Too late'}</span>
            <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">{entry.reactionMs} ms</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
