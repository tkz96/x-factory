// src/frontend/lib/diff-parser.ts — Parses unified git diff into per-file summary and hunks.
//
// The parse itself lives in src/shared/diff-summary.ts, which the worker also reads for its
// `diff_summary` run event (#256); this module only renames the fields for the run page.

import { parseUnifiedDiff } from "../../shared/diff-summary.js";

export interface ParsedDiffFile {
  file: string;
  added: number;
  removed: number;
  hunks: string;
}

/**
 * Parses a unified git diff into an array of per-file diff structures.
 */
export function parseDiffToFiles(
  diff: string | null | undefined,
): ParsedDiffFile[] {
  return parseUnifiedDiff(diff).map(({ path, added, removed, body }) => ({
    file: path,
    added,
    removed,
    hunks: body,
  }));
}
