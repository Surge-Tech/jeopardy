import { useEffect, useRef, useState } from 'react';

// Shared deadline/clock-offset hook used by the board, host and phone views.
// `deadline` and `serverNow` come from the server (epoch ms); we compute a
// clock offset from the most recent `serverNow` so the countdown stays in
// sync even if the client's clock is off, then drive the remaining time with
// requestAnimationFrame for a smooth ring/number.
export function useCountdown(deadline: number | null, serverNow: number | null) {
  const offsetRef = useRef(0); // serverNow - Date.now() at the moment we last heard from the server

  useEffect(() => {
    if (serverNow != null) offsetRef.current = serverNow - Date.now();
  }, [serverNow]);

  const [remainingMs, setRemainingMs] = useState<number | null>(
    deadline != null ? Math.max(0, deadline - (Date.now() + offsetRef.current)) : null,
  );

  useEffect(() => {
    if (deadline == null) {
      setRemainingMs(null);
      return;
    }
    let raf: number;
    const tick = () => {
      const now = Date.now() + offsetRef.current;
      setRemainingMs(Math.max(0, deadline - now));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [deadline]);

  return remainingMs;
}
