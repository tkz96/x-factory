// src/shared/diff-summary.ts — One parser for a unified git diff (#256).
//
// The worker needs a summary of what changed (the `diff_summary` run event) and the run page
// needs the hunks themselves, so both read the same parse instead of keeping two parsers.

export interface DiffFileSummary {
  path: string;
  added: number;
  removed: number;
}

/** What changed in one run's diff, ready to emit and to render. */
export interface DiffSummary {
  files: DiffFileSummary[];
  totalAdded: number;
  totalRemoved: number;
}

/** One file of a parsed diff, with the body text a caller renders hunks from. */
interface ParsedDiffFile extends DiffFileSummary {
  body: string;
}

/**
 * Parses a unified git diff into one entry per file, counting added and removed lines.
 * Tolerant on purpose: a patch with no `diff --git` header is read from its `+++` line, and
 * `+++`/`---` file headers are never counted as content.
 */
export function parseUnifiedDiff(
  diff: string | null | undefined,
): ParsedDiffFile[] {
  if (!diff?.trim()) {
    return [];
  }

  const files: ParsedDiffFile[] = [];
  let current: {
    path: string;
    added: number;
    removed: number;
    body: string[];
  } | null = null;

  const flush = () => {
    if (current) {
      files.push({
        path: current.path,
        added: current.added,
        removed: current.removed,
        body: current.body.join("\n").trim(),
      });
    }
    current = null;
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = {
        path: filenameFromHeader(line),
        added: 0,
        removed: 0,
        body: [],
      };
      continue;
    }

    if (!current) {
      const plusMatch = line.match(/^\+\+\+ b\/(.*)$/);
      if (plusMatch?.[1]) {
        current = { path: plusMatch[1], added: 0, removed: 0, body: [] };
      }
      continue;
    }

    current.body.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.removed++;
    }
  }

  flush();
  return files;
}

/** Summarises a diff into per-file counts and totals. An absent diff summarises to zeroes. */
export function summarizeDiff(diff: string | null | undefined): DiffSummary {
  const files = parseUnifiedDiff(diff).map(({ path, added, removed }) => ({
    path,
    added,
    removed,
  }));
  return {
    files,
    totalAdded: files.reduce((total, file) => total + file.added, 0),
    totalRemoved: files.reduce((total, file) => total + file.removed, 0),
  };
}

/** Reads the destination path out of a `diff --git a/<src> b/<dest>` header. */
function filenameFromHeader(line: string): string {
  const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
  if (match) {
    const dest = match[2];
    const src = match[1];
    // A deleted file is named by its source path; `dev/null` is not a path.
    return (
      (dest !== "dev/null" && dest !== "/dev/null" ? dest : src) || "unknown"
    );
  }
  const parts = line.replace("diff --git ", "").trim().split(" ");
  return (
    parts[1]?.replace(/^b\//, "") || parts[0]?.replace(/^a\//, "") || "unknown"
  );
}
