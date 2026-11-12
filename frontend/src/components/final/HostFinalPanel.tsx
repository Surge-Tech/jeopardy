import ResponseMedia from '../shared/ResponseMedia';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { socket } from '../../socket';
import type { Board, GameState } from '@shared/types';
import { SOCKET_EVENTS as E } from '@shared/socketEvents';
import { useCountdown } from './useCountdown';

interface HostState {
  wagers: Record<string, number>;
  answers: Record<string, string>;
  drafts: Record<string, string>;
}

export default function HostFinalPanel({ roomCode, gameState, board, mediaControls }: {
  roomCode: string; gameState: GameState; board: Board; mediaControls?: ReactNode;
}) {
  const fj = gameState.finalJeopardy!;
  const [hostState, setHostState] = useState<HostState>({ wagers: {}, answers: {}, drafts: {} });
  const [overridePlayerId, setOverridePlayerId] = useState('');
  const [overrideWager, setOverrideWager] = useState('');
  const [overrideAnswer, setOverrideAnswer] = useState('');
  const [error, setError] = useState('');
  const actionsRef = useRef<HTMLElement>(null);
  const remainingMs = useCountdown(fj.deadline, fj.serverNow, 'second');
  const current = fj.contestants[fj.revealIndex];
  const missing = fj.contestants.filter(c => !c.hasWagered);
  const submitted = fj.contestants.filter(c => c.hasAnswered).length;
  const isLast = fj.revealIndex >= fj.contestants.length - 1;
  const judging = fj.stage === 'reveal' && fj.revealStep === 'answer' && !!current;
  const contestantLabel = gameState.mode === 'teams' ? 'Team' : 'Contestant';
  const contestantPlural = gameState.mode === 'teams' ? 'teams' : 'contestants';
  const emit = (event: string, extra = {}) => socket.emit(event, { roomCode, ...extra });

  useEffect(() => {
    function update(state: HostState) { setHostState(state); }
    function requestState() { socket.emit(E.HOST_FJ_GET_STATE, { roomCode }); }
    socket.on(E.FJ_HOST_STATE, update);
    socket.on(E.HOST_CREATED, requestState);
    requestState();
    return () => {
      socket.off(E.FJ_HOST_STATE, update);
      socket.off(E.HOST_CREATED, requestState);
    };
  }, [roomCode]);

  useEffect(() => {
    actionsRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  }, [roomCode, fj.stage, fj.revealIndex, fj.revealStep]);

  let nextEvent: string | undefined;
  let nextLabel = '';
  let shortcut = 'Space';
  if (fj.stage === 'intro') { nextEvent = E.HOST_FJ_REVEAL_CATEGORY; nextLabel = 'Show Category'; }
  else if (fj.stage === 'wagering') { nextEvent = E.HOST_FJ_REVEAL_CLUE; nextLabel = 'Show Clue'; }
  else if (fj.stage === 'clue') { nextEvent = E.HOST_FJ_START_TIMER; nextLabel = `Start Answer Timer · ${board.finalJeopardy?.timerSeconds ?? 30}s`; }
  else if (fj.stage === 'locked') {
    nextEvent = fj.contestants.length ? E.HOST_FJ_BEGIN_REVEAL : E.HOST_FJ_SHOW_RESPONSE;
    nextLabel = fj.contestants.length ? 'Begin Contestant Reveals' : 'Show Correct Answer';
  } else if (fj.stage === 'reveal' && current) {
    if (fj.revealStep === 'name') { nextEvent = E.HOST_FJ_REVEAL_STEP; nextLabel = 'Show Wager'; }
    else if (fj.revealStep === 'wager') { nextEvent = E.HOST_FJ_REVEAL_STEP; nextLabel = 'Show Contestant Answer'; }
    else if (fj.revealStep === 'judged') {
      nextEvent = isLast ? E.HOST_FJ_SHOW_RESPONSE : E.HOST_FJ_NEXT;
      nextLabel = isLast ? 'Show Correct Answer' : `Next ${contestantLabel}`;
      if (isLast) shortcut = 'R';
    }
  } else if (fj.stage === 'response') { nextEvent = E.HOST_FJ_SCOREBOARD; nextLabel = 'Show Final Scoreboard'; }
  const waitingForWagers = fj.stage === 'wagering' && missing.length > 0;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
        target?.closest('input, textarea, select, [contenteditable="true"]') || gameState.phase !== 'playing') return;
      const space = event.code === 'Space' || event.key === ' ';
      if (nextEvent && !waitingForWagers && ((shortcut === 'Space' && space) || (shortcut === 'R' && event.key.toLowerCase() === 'r'))) {
        event.preventDefault(); emit(nextEvent);
      } else if (judging && ['y', 'n'].includes(event.key.toLowerCase())) {
        event.preventDefault(); emit(E.HOST_FJ_JUDGE, { playerId: current!.playerId, correct: event.key.toLowerCase() === 'y' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [roomCode, nextEvent, waitingForWagers, shortcut, judging, current?.playerId, gameState.phase]);

  const title = fj.stage === 'intro' ? 'Ready for Final Jeopardy'
    : fj.stage === 'wagering' ? (missing.length ? 'Waiting for wagers' : 'All wagers are in')
    : fj.stage === 'clue' ? 'Clue on board · Timer not started'
    : fj.stage === 'answering' ? 'Answering in progress'
    : fj.stage === 'locked' ? 'Answers locked'
    : fj.stage === 'reveal' ? `${contestantLabel} ${fj.revealIndex + 1} of ${fj.contestants.length} · ${current?.playerName ?? ''}`
    : fj.stage === 'response' ? 'Correct answer on board' : 'Final scoreboard on board';
  const hint = fj.stage === 'intro' ? 'Show the category so contestants can decide their wagers.'
    : fj.stage === 'wagering' ? (missing.length ? `Waiting for: ${missing.map(c => c.playerName).join(', ')}.` : 'Show the clue when everyone is ready.')
    : fj.stage === 'clue' ? 'Read the clue, then start the answer timer.'
    : fj.stage === 'answering' ? 'Answers lock automatically when time runs out. Unsubmitted drafts are saved.'
    : fj.stage === 'locked' ? 'Reveal each contestant’s wager and answer, starting with the lowest score.'
    : fj.stage === 'reveal' ? ({ name: 'Their name is on the board. Show their wager next.', wager: 'Their wager is on the board. Show their answer next.', answer: 'Their answer is on the board. Accept or reject it to score the wager.', judged: 'Wager scored. Continue, or undo the judgment under More controls.' }[fj.revealStep])
    : fj.stage === 'response' ? 'Show the final scoreboard to finish the reveal.' : 'End the game, or return to the board.';
  const canEditWager = fj.stage === 'intro' || fj.stage === 'wagering';
  const editable = fj.contestants.filter(c => canEditWager || (['clue', 'answering', 'locked', 'reveal'].includes(fj.stage) && !fj.revealed[c.playerId]));
  const selected = editable.find(c => c.playerId === overridePlayerId);

  function applyOverride(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const wager = canEditWager && overrideWager.trim() !== '' ? Number(overrideWager) : undefined;
    if (wager !== undefined && (!Number.isInteger(wager) || wager < 0 || wager > selected.maxWager)) {
      setError(`Enter a whole-number wager between 0 and ${selected.maxWager}.`); return;
    }
    const answer = !canEditWager ? overrideAnswer : undefined;
    if (wager === undefined && answer === undefined) { setError('Enter a wager.'); return; }
    emit(E.HOST_FJ_SET_FOR_PLAYER, { playerId: selected.playerId, wager, answer });
    setOverridePlayerId(''); setOverrideWager(''); setOverrideAnswer(''); setError('');
  }
  const primary = 'w-full rounded-lg bg-jeopardy-gold px-4 py-3 font-bold text-jeopardy-dark hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed';

  return <div className="space-y-4">
    <section ref={actionsRef} aria-label="Question actions" className="space-y-2">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Final Jeopardy actions</h2>
      {judging ? <div className="flex gap-2">
        <button className="flex-1 rounded-lg bg-green-600 hover:bg-green-500 py-3 font-bold" onClick={() => emit(E.HOST_FJ_JUDGE, { playerId: current.playerId, correct: true })}>✓ Accept (Y)</button>
        <button className="flex-1 rounded-lg bg-red-600 hover:bg-red-500 py-3 font-bold" onClick={() => emit(E.HOST_FJ_JUDGE, { playerId: current.playerId, correct: false })}>✗ Reject (N)</button>
      </div> : nextEvent ? <button className={primary} disabled={waitingForWagers} onClick={() => emit(nextEvent!)}>{nextLabel} ({shortcut})</button>
        : fj.stage === 'answering' ? <div className="rounded-lg bg-gray-800 p-3 text-center text-gray-300">Waiting for the answer timer…</div>
        : fj.stage === 'final' ? <button className={primary} onClick={() => { if (confirm('End the game and show the leaderboard?')) emit(E.HOST_END_GAME); }}>End Game</button> : null}
      {mediaControls}
      {(waitingForWagers || editable.length > 0 || (fj.stage === 'reveal' && fj.revealStep === 'judged') || fj.stage === 'final') &&
        <details className="text-sm text-gray-400">
          <summary className="cursor-pointer py-1 hover:text-white">More controls</summary>
          <div className="mt-2 space-y-3">
            {waitingForWagers && <div className="space-y-2">
              <p className="text-sm text-orange-300">Continue without {missing.length} missing wager(s). Each missing wager will be set to 0.</p>
              <button className="w-full rounded-lg bg-orange-700 hover:bg-orange-600 text-white p-3 font-bold" onClick={() => emit(E.HOST_FJ_REVEAL_CLUE, { force: true })}>Use 0 for Missing Wagers and Show Clue</button>
            </div>}
            {fj.stage === 'reveal' && fj.revealStep === 'judged' && <button className="btn-ghost text-sm w-full" onClick={() => emit(E.HOST_FJ_UNDO)}>Undo Last Judgment</button>}
            {fj.stage === 'final' && <button className="btn-ghost text-sm w-full" onClick={() => emit(E.HOST_FJ_EXIT)}>Return to Board</button>}
            {editable.length > 0 && <form onSubmit={applyOverride} className="space-y-2 border-t border-gray-700 pt-3">
              <label className="block" htmlFor="fj-contestant">Enter or correct {canEditWager ? 'a wager' : 'an answer'}</label>
              <select id="fj-contestant" className="input-field w-full" value={selected?.playerId ?? ''} onChange={event => {
                const id = event.target.value;
                setOverridePlayerId(id); setOverrideWager(String(hostState.wagers[id] ?? ''));
                setOverrideAnswer(hostState.answers[id] ?? hostState.drafts[id] ?? ''); setError('');
              }}>
                <option value="">Choose a {contestantLabel.toLowerCase()}</option>
                {editable.map(c => <option key={c.playerId} value={c.playerId}>{c.playerName}</option>)}
              </select>
              {selected && <>
                {canEditWager ? <label className="block">Wager · 0–{selected.maxWager}<input aria-label="Contestant wager" className="input-field w-full mt-1" type="number" min={0} max={selected.maxWager} step={1} required value={overrideWager} onChange={event => setOverrideWager(event.target.value)} /></label>
                  : <label className="block">Answer<textarea aria-label="Contestant answer" className="input-field w-full mt-1" value={overrideAnswer} onChange={event => setOverrideAnswer(event.target.value)} /></label>}
                <button className="btn-ghost w-full text-sm">Save {canEditWager ? 'Wager' : 'Answer'}</button>
              </>}
              {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
            </form>}
          </div>
        </details>}
    </section>

    <section aria-label="Question status" className="rounded-xl border border-yellow-700 bg-gray-950/50 p-4 space-y-3">
      <div role="status">
        <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Final Jeopardy · Buzzers closed</div>
        <div className="font-bold text-lg text-jeopardy-gold">{title}</div>
        <p className="text-sm text-gray-300 mt-1">{hint}</p>
      </div>
      {fj.stage === 'answering' && remainingMs != null && <div role="timer" aria-label="Final answer countdown" className="text-3xl font-black text-jeopardy-gold tabular-nums">{Math.ceil(remainingMs / 1000)}s</div>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        <span>Wagers: {fj.contestants.length - missing.length}/{fj.contestants.length}</span>
        <span>Answers: {submitted}/{fj.contestants.length}</span>
        <span>Judged: {Object.keys(fj.revealed).length}/{fj.contestants.length}</span>
      </div>
      {fj.stage === 'reveal' && current && <div className="rounded-lg border border-yellow-700 bg-gray-800 p-3 space-y-2">
        <div className="font-bold text-jeopardy-gold">{current.playerName}</div>
        <div className="text-sm">Wager: {hostState.wagers[current.playerId] ?? fj.currentReveal?.wager ?? fj.revealed[current.playerId]?.wager ?? '—'}</div>
        <p className="whitespace-pre-wrap break-words text-sm">Answer: {hostState.answers[current.playerId] ?? fj.currentReveal?.answer ?? fj.revealed[current.playerId]?.answer ?? '—'}</p>
        {fj.revealed[current.playerId] && <div className="font-bold text-sm">{fj.revealed[current.playerId].correct ? 'Accepted' : 'Rejected'} · {fj.revealed[current.playerId].correct ? '+' : '−'}{fj.revealed[current.playerId].wager}</div>}
      </div>}
      <details className="text-sm text-gray-300">
        <summary className="cursor-pointer">{fj.contestants.length} {contestantPlural} · Submissions (host only)</summary>
        <div className="mt-3 space-y-2">{fj.contestants.map(c => <div key={c.playerId} className="bg-gray-800 rounded-lg p-3 text-sm space-y-1">
          <div className="font-bold">{c.playerName}</div>
          <div className="text-gray-400">Wager: {hostState.wagers[c.playerId] ?? fj.revealed[c.playerId]?.wager ?? (c.hasWagered ? 'Submitted' : 'Waiting')}</div>
          <div className="whitespace-pre-wrap break-words">Answer: {hostState.answers[c.playerId] ?? fj.revealed[c.playerId]?.answer ?? (hostState.drafts[c.playerId] ? `Typing: ${hostState.drafts[c.playerId]}` : c.hasAnswered ? 'Submitted' : 'Waiting')}</div>
        </div>)}</div>
      </details>
    </section>

    {board.finalJeopardy && <section aria-label="Question information" className="space-y-3">
      <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">{board.finalJeopardy.category}</h2>
      <div className="bg-gray-800 rounded-lg p-4 text-lg leading-relaxed break-words">
        <div className="text-xs text-gray-400 uppercase mb-2">Clue · {['intro', 'wagering'].includes(fj.stage) ? 'Host only' : 'Shown on board'}</div>
        {board.finalJeopardy.clue}
      </div>
      <div className="bg-green-950 border border-green-700 rounded-lg p-4 text-lg text-green-300 leading-relaxed break-words">
        <div className="text-xs text-green-400 uppercase mb-2">Correct answer · {['response', 'final'].includes(fj.stage) ? 'Shown on board' : 'Host only'}</div>
        {board.finalJeopardy.response}<ResponseMedia {...board.finalJeopardy} />
      </div>
    </section>}
  </div>;
}
