import { useEffect } from 'react';
import type { Board } from '@shared/types';

// Warm the browser image cache without mounting hidden answer content or
// downloading every audio/video file. Limit concurrent background requests.
export function useBoardImagePreload(board: Board | null, roundIndex: number, activeQuestionId?: string | null) {
  useEffect(() => {
    if (!board) return;
    const questions = (board.rounds[roundIndex] ?? board.rounds[0])?.categories.flatMap(c => c.questions) ?? [];
    const ordered = [...questions].sort((a, b) => Number(b.id === activeQuestionId) - Number(a.id === activeQuestionId));
    const urls = new Set<string>();
    for (const question of [...ordered, ...(board.finalJeopardy ? [board.finalJeopardy] : [])]) {
      if (question.mediaType === 'image' && question.mediaUrl) urls.add(question.mediaUrl);
      if (question.responseMediaType === 'image' && question.responseMediaUrl) urls.add(question.responseMediaUrl);
    }
    const queue = [...urls];
    let cancelled = false;
    const pending = new Set<HTMLImageElement>();
    function next() {
      const url = queue.shift();
      if (cancelled || !url) return;
      const image = new window.Image();
      pending.add(image);
      image.onload = image.onerror = () => {
        pending.delete(image);
        next();
      };
      image.src = url;
    }
    for (let i = 0; i < 3; i++) next();
    return () => {
      cancelled = true;
      for (const image of pending) image.onload = image.onerror = null;
    };
  }, [board, roundIndex, activeQuestionId]);
}
