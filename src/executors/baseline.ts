// src/executors/baseline.ts — Worktree baseline file state resolution and persistence.

import {
  type BaselineState,
  loadRecordedBaseline,
  saveRecordedBaseline,
} from "../worktree-state.js";

/**
 * Loads baseline state from baseline.json in artifactsDir or falls back to recording a fresh baseline.
 * If persistIfMissing is true, saves the recorded baseline to baselineJsonPath.
 */
export async function resolveWorktreeBaseline(
  baselineJsonPath: string,
  worktreePath: string,
  readFile: (path: string, encoding: "utf-8") => Promise<string>,
  recordBaseline: (worktreePath: string) => Promise<BaselineState>,
  writeFile?:
    | ((path: string, content: string, encoding: "utf-8") => Promise<void>)
    | undefined,
): Promise<BaselineState> {
  try {
    return await loadRecordedBaseline(baselineJsonPath, readFile);
  } catch {
    const baseline = await recordBaseline(worktreePath);
    if (writeFile) {
      await saveRecordedBaseline(baselineJsonPath, baseline, writeFile);
    }
    return baseline;
  }
}
