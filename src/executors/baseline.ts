// src/executors/baseline.ts — Worktree baseline file state resolution and persistence.

import type { BaselineState } from "../git.js";

export interface BaselineJson {
  trackedFiles: string[];
  untrackedFiles: string[];
}

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
    const content = await readFile(baselineJsonPath, "utf-8");
    const parsed = JSON.parse(content) as BaselineJson;
    return {
      trackedFiles: new Set(parsed.trackedFiles || []),
      untrackedFiles: new Set(parsed.untrackedFiles || []),
    };
  } catch {
    const baseline = await recordBaseline(worktreePath);
    if (writeFile) {
      await writeFile(
        baselineJsonPath,
        JSON.stringify(
          {
            trackedFiles: Array.from(baseline.trackedFiles),
            untrackedFiles: Array.from(baseline.untrackedFiles),
          },
          null,
          2,
        ),
        "utf-8",
      );
    }
    return baseline;
  }
}
