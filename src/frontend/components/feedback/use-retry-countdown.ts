// src/frontend/components/feedback/use-retry-countdown.ts — Rate-limit timed
// guidance (#129, spec #133 user story 26): ticks the remaining rate-limit
// window once per second so the retry affordance un-disables itself instead
// of hammering the provider. Server rendering and renderToString tests see
// the initial value; happy-dom tests verify the tick.

import { useEffect, useState } from "react";

/** Returns the remaining rate-limit window in ms, ticking down once per second. */
export function useRetryCountdown(
  retryAfterMs: number | undefined,
): number | undefined {
  const [remainingMs, setRemainingMs] = useState<number | undefined>(
    retryAfterMs,
  );

  useEffect(() => {
    if (retryAfterMs === undefined || retryAfterMs <= 0) {
      setRemainingMs(retryAfterMs);
      return;
    }
    setRemainingMs(retryAfterMs);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const remaining = retryAfterMs - (Date.now() - startedAt);
      if (remaining <= 0) {
        clearInterval(timer);
        setRemainingMs(0);
        return;
      }
      setRemainingMs(remaining);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAfterMs]);

  return remainingMs;
}
