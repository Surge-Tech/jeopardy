import { getCompetitor, getCompetitors } from '@shared/competitors';
import ResponseMedia from '../shared/ResponseMedia';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { socket } from '../../socket';
import type { GameState, Question } from '@shared/types';
import { SOCKET_EVENTS } from '@shared/socketEvents';

export default function DDHostPanel({
  roomCode, gameState, activeQ, onAward, onReveal, onShowAnswer, onClose, category, mediaControls,
}: {
  roomCode: string;
  gameState: GameState;
  activeQ: Question;
  onAward: (playerId: string, correct: boolean) => void;
  onReveal: () => void;
  onShowAnswer: () => void;
  onClose: () => void;
  category?: string;
  mediaControls?: ReactNode;
}) {
  const dd = gameState.dailyDouble!;
  const [overrideAmount, setOverrideAmount] = useState('');
  const [error, setError] = useState('');
  const actionsRef = useRef<HTMLElement>(null);
  const revealed = gameState.dailyDoubleRevealed;
  const responseVisible = gameState.responseVisible;
  const player = dd.playerId ? getCompetitor(gameState, dd.playerId) : null;
  const overrideUnlocked = !dd.hasDevice || dd.submittedByPlayer;
  const canJudge = dd.stage === 'ready' && revealed && !dd.outcome && !responseVisible;
  const stage = dd.stage !== 'ready' ? dd.stage : !revealed ? 'reveal' : !dd.outcome ? 'judge' : responseVisible ? 'close' : 'answer';

  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [activeQ.id, stage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        target?.closest('input, textarea, select, [contenteditable="true"]') || gameState.phase !== 'playing') return;
      const space = event.code === 'Space' || event.key === ' ';
      let action: (() => void) | undefined;
      if (space && stage === 'reveal') action = onReveal;
      else if (space && stage === 'close') action = onClose;
      else if (event.key.toLowerCase() === 'r' && stage === 'answer') action = onShowAnswer;
      else if (canJudge && dd.playerId) {
        if (event.key.toLowerCase() === 'y') action = () => onAward(dd.playerId!, true);
        else if (event.key.toLowerCase() === 'n') action = () => onAward(dd.playerId!, false);
      }
      if (action) { event.preventDefault(); action(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [stage, canJudge, dd.playerId, gameState.phase, onReveal, onClose, onShowAnswer, onAward]);

  function applyOverride(event: FormEvent) {
    event.preventDefault();
    const amount = Number(overrideAmount);
    if (!overrideAmount.trim() || !Number.isInteger(amount) || amount < 0 || amount > dd.maxWager) {
      setError(`Enter a whole number between 0 and ${dd.maxWager}.`);
      return;
    }
    socket.emit(SOCKET_EVENTS.HOST_DD_OVERRIDE_WAGER, { roomCode, amount }, (res: { ok: boolean; error?: string }) => {
      if (res.ok) { setOverrideAmount(''); setError(''); }
      else setError(res.error ?? 'Could not set the wager.');
    });
  }

  const title = dd.stage === 'picking' ? 'Choose a contestant' : dd.stage === 'wagering' ? 'Waiting for a wager'
    : !revealed ? 'Wager locked · Ready for the clue' : responseVisible ? 'Answer on board'
    : dd.outcome === 'correct' ? 'Answer accepted' : dd.outcome === 'wrong' ? 'Answer rejected' : `${player?.name ?? 'Contestant'} is answering`;
  const hint = dd.stage === 'picking' ? 'Choose who will play this Daily Double.'
    : dd.stage === 'wagering' ? (dd.hasDevice ? 'The contestant submits their wager on their device.' : 'Enter the contestant’s wager above.')
    : !revealed ? 'Show the clue when the contestant is ready.' : responseVisible ? 'Close the question to return to the board.'
    : dd.outcome ? 'The wager has been scored. Show the answer before closing.' : 'Only this contestant answers. Accept or reject their answer; buzzers stay closed.';
  const primary = 'w-full rounded-lg bg-jeopardy-gold px-4 py-3 font-bold text-jeopardy-dark hover:brightness-110';
  const wagerForm = <form onSubmit={applyOverride} className="space-y-2">
    <label className="block text-sm text-gray-300" htmlFor="dd-wager">Wager · 0–{dd.maxWager}</label>
    <div className="flex gap-2">
      <input id="dd-wager" type="number" min={0} max={dd.maxWager} step={1} required
        className="input-field text-sm min-w-0 flex-1" value={overrideAmount}
        onChange={event => { setOverrideAmount(event.target.value); setError(''); }} disabled={!overrideUnlocked} />
      <button className="rounded-lg bg-jeopardy-gold text-jeopardy-dark px-3 font-bold disabled:opacity-40" disabled={!overrideUnlocked}>Set wager</button>
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </form>;

  return <div className="space-y-4">
    <section ref={actionsRef} aria-label="Question actions" className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Daily Double actions</h2>
      {dd.stage === 'picking' ? (
        <div className="space-y-2">
          {getCompetitors(gameState).map(contestant => <button key={contestant.id}
            className="w-full flex justify-between items-center rounded-lg bg-gray-800 hover:bg-gray-700 p-3 text-sm"
            onClick={() => socket.emit(SOCKET_EVENTS.HOST_DD_PICK_PLAYER, { roomCode, playerId: contestant.id })}>
            <span className="font-bold">{contestant.name}</span><span>Choose</span>
          </button>)}
          {getCompetitors(gameState).length === 0 && <p className="text-sm text-gray-400">Add a player in the Players tab to continue.</p>}
        </div>
      ) : dd.stage === 'wagering' ? (
        overrideUnlocked ? wagerForm : <div className="rounded-lg bg-gray-800 p-3 text-sm text-gray-300">Waiting for {player?.name} to submit a wager…</div>
      ) : stage === 'reveal' ? <button className={primary} onClick={onReveal}>Show Clue (Space)</button>
        : canJudge ? <div className="flex gap-2">
          <button className="flex-1 rounded-lg bg-green-600 hover:bg-green-500 py-3 font-bold" onClick={() => onAward(dd.playerId!, true)}>✓ Accept (Y)</button>
          <button className="flex-1 rounded-lg bg-red-600 hover:bg-red-500 py-3 font-bold" onClick={() => onAward(dd.playerId!, false)}>✗ Reject (N)</button>
        </div> : stage === 'answer' ? <button className={primary} onClick={onShowAnswer}>Show Answer on Board (R)</button>
        : stage === 'close' ? <button className={primary} onClick={onClose}>Close Question (Space)</button> : null}
      {mediaControls}
      {!revealed && <details className="text-sm text-gray-400">
        <summary className="cursor-pointer py-1 hover:text-white">More controls</summary>
        <div className="mt-2 space-y-3">
          {dd.stage === 'ready' && wagerForm}
          <button className="btn-danger text-sm w-full" onClick={onClose}>Skip Question</button>
        </div>
      </details>}
    </section>

    <section aria-label="Question status" className="rounded-xl border border-yellow-700 bg-gray-950/50 p-4 space-y-3">
      <div role="status">
        <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Daily Double · Buzzers closed</div>
        <div className="font-bold text-lg text-jeopardy-gold">{title}</div>
        <p className="text-sm text-gray-300 mt-1">{hint}</p>
      </div>
      {player && <div className="flex flex-wrap justify-between gap-2 text-sm">
        <span className="font-bold">{player.name}</span>
        <span className="text-jeopardy-gold">{dd.wager == null ? `Maximum wager: ${dd.maxWager}` : `Wager: ${dd.wager}`}</span>
      </div>}
    </section>

    <section aria-label="Question information" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">{category || 'Question information'}</h2>
        <span className="text-jeopardy-gold font-black text-xl">{activeQ.value}</span>
      </div>
      <div className="bg-gray-800 rounded-lg p-4 text-lg leading-relaxed break-words">
        <div className="text-xs text-gray-400 uppercase mb-2">Clue · {revealed ? 'Shown on board' : 'Host only'}</div>
        {activeQ.clue}
      </div>
      <div className="bg-green-950 border border-green-700 rounded-lg p-4 text-lg text-green-300 leading-relaxed break-words">
        <div className="text-xs text-green-400 uppercase mb-2">Answer · {responseVisible ? 'Shown on board' : 'Host only'}</div>
        {activeQ.response}<ResponseMedia {...activeQ} />
      </div>
    </section>
  </div>;
}
