// src/frontend/lib/minute-ticker.ts — One shared clock for relative labels (#321). Every time on the
// run page reads it, so a long run keeps one interval and the timeline's parents do not render again
// each minute: only the labels that read the clock do.

import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

let current = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

/** Sets the shared time and tells every label. The interval calls it; tests call it with a time. */
export function refreshMinuteTicker(now: number = Date.now()): void {
  current = now;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    // The clock stood still while nobody read it, so catch up before the first label shows.
    current = Date.now();
    timer = setInterval(() => refreshMinuteTicker(), MINUTE_MS);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

const snapshot = () => current;

/** The shared time, refreshed each minute. */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
