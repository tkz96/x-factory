// src/frontend/components/runs/useRunSplit.ts — The run page's split: the share of the row the chat
// panel takes, in whole percent (20 to 80, 50 by default). The viewer's choice is remembered per
// browser; a blocked or throwing store means the default applies and the choice is not remembered.

import { useCallback, useState } from "react";

export const RUN_SPLIT_DEFAULT = 50;
export const RUN_SPLIT_MIN = 20;
export const RUN_SPLIT_MAX = 80;
export const RUN_SPLIT_STORAGE_KEY = "xf.runSplit";

/** Clamps a percentage to the allowed range and rounds it to a whole percent. */
export function clampRunSplit(percent: number): number {
  if (!Number.isFinite(percent)) return RUN_SPLIT_DEFAULT;
  return Math.min(RUN_SPLIT_MAX, Math.max(RUN_SPLIT_MIN, Math.round(percent)));
}

/** The split the viewer left last time, or the default when none is valid. */
export function readRunSplit(): number {
  try {
    const stored = window.localStorage.getItem(RUN_SPLIT_STORAGE_KEY);
    if (stored === null) return RUN_SPLIT_DEFAULT;
    return clampRunSplit(Number(stored));
  } catch {
    return RUN_SPLIT_DEFAULT;
  }
}

/** Remembers the split. A blocked store is not an error for the user. */
export function writeRunSplit(percent: number): void {
  try {
    window.localStorage.setItem(RUN_SPLIT_STORAGE_KEY, String(percent));
  } catch {
    // The choice stays for this visit only.
  }
}

export interface RunSplit {
  split: number;
  setSplit: (percent: number) => void;
  resetSplit: () => void;
}

/** The split as state, remembered in browser storage on every change. */
export function useRunSplit(): RunSplit {
  const [split, setSplitState] = useState<number>(readRunSplit);

  const setSplit = useCallback((percent: number) => {
    const next = clampRunSplit(percent);
    setSplitState(next);
    writeRunSplit(next);
  }, []);

  const resetSplit = useCallback(() => setSplit(RUN_SPLIT_DEFAULT), [setSplit]);

  return { split, setSplit, resetSplit };
}
