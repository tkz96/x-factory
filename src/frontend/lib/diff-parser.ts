// src/frontend/lib/diff-parser.ts — Parses unified git diff into per-file summary and hunks.

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
  if (!diff?.trim()) {
    return [];
  }

  const files: ParsedDiffFile[] = [];
  const lines = diff.split("\n");

  let currentFile: string | null = null;
  let added = 0;
  let removed = 0;
  const currentHunkLines: string[] = [];

  const flushCurrent = () => {
    if (currentFile) {
      files.push({
        file: currentFile,
        added,
        removed,
        hunks: currentHunkLines.join("\n").trim(),
      });
    }
    currentFile = null;
    added = 0;
    removed = 0;
    currentHunkLines.length = 0;
  };

  for (const line of lines) {
    // Detect diff header
    if (line.startsWith("diff --git ")) {
      flushCurrent();

      // Extract filename from "diff --git a/path/to/file b/path/to/file"
      const match = line.match(/^diff --git a\/(.*) b\/(.*)$/);
      if (match) {
        const dest = match[2];
        const src = match[1];
        const chosen = dest !== "dev/null" && dest !== "/dev/null" ? dest : src;
        currentFile = chosen || "unknown";
      } else {
        // Fallback extraction
        const parts = line.replace("diff --git ", "").trim().split(" ");
        currentFile =
          parts[1]?.replace(/^b\//, "") ||
          parts[0]?.replace(/^a\//, "") ||
          "unknown";
      }
      continue;
    }

    if (!currentFile) {
      // If diff doesn't start with diff --git (e.g. raw patch with --- a/... +++ b/...)
      const plusMatch = line.match(/^\+\+\+ b\/(.*)$/);
      if (plusMatch?.[1]) {
        currentFile = plusMatch[1];
        continue;
      }
    }

    if (currentFile) {
      // Accumulate diff content
      currentHunkLines.push(line);

      if (line.startsWith("+") && !line.startsWith("+++")) {
        added++;
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        removed++;
      }
    }
  }

  flushCurrent();
  return files;
}
