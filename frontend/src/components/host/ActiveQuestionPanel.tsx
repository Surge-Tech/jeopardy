import { useEffect, useRef, type ReactNode } from 'react';
import { hasPendingAnswer } from '@shared/questionFlow';
import ResponseMedia from '../shared/ResponseMedia';
import BuzzResults from '../shared/BuzzResults';
import type { BuzzEntry, Player, Question } from '@shared/types';
import { PERMANENT_LOCKOUT } from '@shared/types';

export default function ActiveQuestionPanel({
  activeQ,
  clueVisible,
  readingClue = false,
  onRevealClue,
  responseVisible,
  buzzerState,
  buzzWinner,
  buzzWinnerId,
  players,
  buzzLockouts,
  buzzHistory,
  collectingBuzzes = false,
  buzzedPlayerId,
  onShowAnswer,
  onEnableBuzzer,
  onLockBuzzer,
  onResetBuzzer,
  onAward,
  onMarkWrong,
  onClose,
  category,
  statusContent,
  mediaControls,
}: {
  category?: string;
  statusContent?: ReactNode;
  mediaControls?: ReactNode;
  activeQ: Question;
  clueVisible: boolean;
  readingClue?: boolean;
  onRevealClue: () => void;
  responseVisible: boolean;
  buzzerState: 'idle' | 'open' | 'locked';
  buzzWinner: string | null;
  buzzWinnerId: string | null;
  players: Player[];
  buzzLockouts: Record<string, number>;
  buzzHistory: BuzzEntry[];
  collectingBuzzes?: boolean;
  buzzedPlayerId: string | null;
  onShowAnswer: () => void;
  onEnableBuzzer: () => void;
  onLockBuzzer: () => void;
  onResetBuzzer: () => void;
  onAward: (playerId: string, correct: boolean) => void;
  onMarkWrong: (playerId: string) => void;
  onClose: () => void;
}) {
  const actionsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // Clicking a card does not move focus out of form fields in every browser.
    // Give the newly selected question a predictable keyboard starting point.
    actionsRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  }, [activeQ.id]);

  const pendingAnswer = hasPendingAnswer({ buzzedPlayerId, buzzHistory });
  const lockedOut = players.filter(p => buzzLockouts[p.id] === PERMANENT_LOCKOUT);

  const judged = !!buzzedPlayerId && !pendingAnswer;
  const stage = !clueVisible ? 0 : responseVisible ? 4 : pendingAnswer ? 2 : judged ? 3 : 1;
  const title = !clueVisible ? 'Card selected' : pendingAnswer ? `${buzzWinner ?? 'Player'} is answering`
    : responseVisible ? 'Answer on board' : judged ? 'Answer accepted'
    : readingClue ? 'Reading clue recording' : collectingBuzzes ? 'Receiving buzzes' : buzzerState === 'open' ? 'Waiting for a buzz' : 'Clue on board';
  const hint = !clueVisible ? 'Press Space to activate this card, or select another card to change your choice.' : pendingAnswer ? 'Accept the answer, or reject it to reopen buzzers.'
    : responseVisible ? 'Close the question to return to the board.' : judged ? 'Show the answer, then close the question.'
    : readingClue ? 'Buzzers will open automatically when the recording finishes. If autoplay is blocked, press Play on the board.'
    : buzzerState === 'open' ? 'If nobody answers, show the answer to continue.' : 'Open buzzers when players can answer.';
  const primary = 'w-full min-h-12 rounded-lg bg-jeopardy-gold px-4 py-3 font-bold text-jeopardy-dark hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed';

  return (
    <div className="space-y-4">
      <section ref={actionsRef} aria-label="Question actions" className="space-y-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">Question actions</h2>
        {!clueVisible ? (
          <button className={primary} onClick={onRevealClue}>{activeQ.isDailyDouble ? 'Activate Daily Double (Space)' : 'Show Clue (Space)'}</button>
        ) : pendingAnswer ? (
          <div className="flex gap-2">
            <button className="flex-1 rounded-lg bg-green-600 hover:bg-green-500 py-3 font-bold" disabled={!buzzWinnerId}
              onClick={() => { if (buzzWinnerId) onAward(buzzWinnerId, true); }}>✓ Accept (Y)</button>
            <button className="flex-1 rounded-lg bg-red-600 hover:bg-red-500 py-3 font-bold" disabled={!buzzWinnerId}
              onClick={() => { if (buzzWinnerId) onMarkWrong(buzzWinnerId); }}>✗ Reject (N)</button>
          </div>
        ) : responseVisible ? (
          <button className={primary} onClick={onClose}>Close Question (Space)</button>
        ) : buzzerState === 'idle' && !judged ? (
          <>
            <button className={primary} onClick={onEnableBuzzer}>{readingClue ? 'Skip Recording & Open Buzzers (Space)' : 'Open Buzzers (Space)'}</button>
            <button className="btn-ghost text-sm w-full" onClick={onShowAnswer}>Show Answer on Board (R)</button>
          </>
        ) : (
          <button className={primary} disabled={collectingBuzzes && !judged} onClick={onShowAnswer}>Show Answer on Board (R)</button>
        )}
        {mediaControls}
        {(!responseVisible || pendingAnswer) && <details className="text-sm text-gray-400">
          <summary className="cursor-pointer py-1 hover:text-white">More controls</summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {clueVisible && !responseVisible && <>
              {buzzerState === 'open' && <button className="btn-ghost text-sm" onClick={onLockBuzzer}>Lock Buzzers</button>}
              <button className="btn-ghost text-sm" aria-label="Reset Buzzers"
                title="Cancel the current buzz and clear the buzz results without changing scores, then reopen buzzers."
                onClick={onResetBuzzer}>Reset Buzzers</button>
            </>}
            {!responseVisible && <button className="btn-danger text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={pendingAnswer} onClick={onClose}>Close Question</button>}
          </div>
          {pendingAnswer && <p className="mt-2 text-xs text-yellow-300">Judge the current answer or reset buzzers before closing.</p>}
        </details>}
      </section>

      <section aria-label="Question status" className="rounded-xl border border-gray-700 bg-gray-950/50 p-4 space-y-3">
        <div role="status">
          <div className="text-xs uppercase tracking-wider text-gray-400 mb-1">Question status</div>
          <div className="font-bold text-lg text-jeopardy-gold">{title}</div>
          <p className="text-sm text-gray-300 mt-1">{hint}</p>
        </div>
        <ol aria-label="Question progress" className="flex gap-1">
          {['Selected', 'Clue / buzzers', 'Judge', 'Answer', 'Close'].map((label, index) => (
            <li key={label} aria-current={index === stage ? 'step' : undefined}
              className={`flex-1 border-t-2 pt-2 text-[10px] ${index <= stage ? 'border-jeopardy-gold text-jeopardy-gold' : 'border-gray-700 text-gray-500'}`}>{label}</li>
          ))}
        </ol>
        {statusContent}
        {lockedOut.length > 0 && (
          <div className="mt-2">
            <div className="text-[10px] text-gray-500 uppercase mb-1">Ineligible this question</div>
            <div className="flex flex-wrap gap-1">
              {lockedOut.map(p => (
                <span key={p.id} className="text-xs bg-red-900 text-red-300 px-2 py-0.5 rounded-full">
                  {p.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {!collectingBuzzes && <BuzzResults entries={buzzHistory} winnerId={buzzedPlayerId} />}

      </section>

      <section aria-label="Question information" className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">{category || 'Question information'}</h2>
          <span className="text-jeopardy-gold font-black text-xl">{activeQ.value}</span>
        </div>
        <div className="bg-gray-800 rounded-lg p-4 text-lg text-white leading-relaxed break-words">
          <div className="text-xs text-gray-400 uppercase mb-2">Clue</div>
          {activeQ.clue}
        {activeQ.mediaType === 'image' && activeQ.mediaUrl && <img src={activeQ.mediaUrl} alt="Clue image"
          className="mt-3 max-h-80 w-full rounded-lg object-contain" />}
        </div>
        <div className={`border rounded-lg p-4 text-lg leading-relaxed break-words transition-colors ${responseVisible
          ? 'bg-jeopardy-gold/10 border-jeopardy-gold text-white'
          : 'bg-gray-800 border-gray-700 text-gray-300'}`}>
          <div className={`text-xs uppercase mb-2 ${responseVisible ? 'text-jeopardy-gold' : 'text-gray-400'}`}>Answer · {responseVisible ? 'Shown on board' : 'Host only'}</div>
          {activeQ.response}
          <ResponseMedia {...activeQ} staticOnly />
        </div>
      </section>
    </div>
  );
}
