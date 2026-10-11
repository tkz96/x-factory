// src/frontend/hooks/useNow.ts — The current time, refreshed on an interval so relative labels stay true.

import { useEffect, useState } from "react";

/** The current time, refreshed each minute so relative labels stay true. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
