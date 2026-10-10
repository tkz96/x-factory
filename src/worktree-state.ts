// src/worktree-state.ts — What changed in a worktree, against the baseline recorded at preparation.

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPollutionPath } from "./pollution.js";
import { execStrict, TRUNCATION_MARKER } from "./proc.js";

export interface BaselineState {
  trackedFiles: Set<string>;
  untrackedFiles: Set<string>;
}

/**
 * - implementation: a change the run is meant to deliver.
 * - scaffold: X-Factory's own workspace files (`.agent/`, `ralph.sh`).
 * - pollution: sensitive or generated files that must never be delivered.
 */
export type ChangeKind = "implementation" | "scaffold" | "pollution";

export interface WorktreeChange {
  /** Exact repo-relative path (the destination path for renames and copies). */
  path: string;
  /** Two-character porcelain status code, e.g. " M", "??", "R ". */
  status: string;
  kind: ChangeKind;
}

export interface WorktreeState {
  changes: WorktreeChange[];
  implementationPaths: string[];
  hasImplementationChanges: boolean;
  hasPollution: boolean;
  pollutionDetails: string[];
}

interface StatusEntry {
  status: string;
  path: string;
}

const UNTRACKED = "??";
const STATUS_MAX_CHARS = 16 * 1024 * 1024;

/** Only `.git` itself is git metadata; `.github/` and `.gitignore` are repository content. */
function isGitMetadataPath(relPath: string): boolean {
  return relPath === ".git" || relPath.startsWith(".git/");
}

function isScaffoldPath(relPath: string): boolean {
  return relPath === "ralph.sh" || relPath.startsWith(".agent/");
}

/** Pollution wins over scaffold, so a log or secret under `.agent/` is still blocked. */
function classify(relPath: string): ChangeKind {
  if (isPollutionPath(relPath)) return "pollution";
  if (isScaffoldPath(relPath)) return "scaffold";
  return "implementation";
}

/**
 * Parse `git status --porcelain -z` output. Each entry is `XY <path>` terminated
 * by NUL; renames and copies carry the source path as a second NUL-terminated field.
 * A rename is reported under its new path, plus its source as a deletion when the
 * source falls in a different kind (e.g. `src/a.ts` moved into `.agent/`).
 */
function parseStatus(raw: string): StatusEntry[] {
  const fields = raw.split("\0");
  const entries: StatusEntry[] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    const status = field.slice(0, 2);
    const relPath = field.slice(3);
    if (!isGitMetadataPath(relPath)) entries.push({ status, path: relPath });
    if (status.includes("R")) {
      const source = fields[++i];
      if (source && classify(source) !== classify(relPath)) {
        entries.push({ status: "D ", path: source });
      }
    } else if (status.includes("C")) {
      i++;
    }
  }
  return entries;
}

async function gitOutput(
  worktreePath: string,
  args: string[],
  signal?: AbortSignal | undefined,
): Promise<string> {
  const result = await execStrict("git", args, {
    signal,
    cwd: worktreePath,
    rawStdout: true,
    maxBufferChars: STATUS_MAX_CHARS,
    envPolicy: "inherit",
  });
  if (result.stdout.endsWith(TRUNCATION_MARKER)) {
    throw new Error(
      `git ${args[0]} output for ${worktreePath} exceeded ${STATUS_MAX_CHARS} characters; refusing to classify a partial file list.`,
    );
  }
  return result.stdout;
}

async function readStatus(
  worktreePath: string,
  signal?: AbortSignal | undefined,
): Promise<StatusEntry[]> {
  return parseStatus(
    await gitOutput(
      worktreePath,
      ["status", "--porcelain", "-z", "-uall"],
      signal,
    ),
  );
}

/**
 * Record the worktree's file state before implementation starts.
 */
export async function recordBaseline(
  worktreePath: string,
  signal?: AbortSignal | undefined,
): Promise<BaselineState> {
  const tracked = await gitOutput(worktreePath, ["ls-files", "-z"], signal);
  const trackedFiles = new Set(
    tracked.split("\0").filter((f) => f && !isGitMetadataPath(f)),
  );
  const untrackedFiles = new Set(
    (await readStatus(worktreePath, signal))
      .filter((entry) => entry.status === UNTRACKED)
      .map((entry) => entry.path),
  );
  return { trackedFiles, untrackedFiles };
}

/**
 * Classify every change in the worktree since the recorded baseline.
 * Files that were already untracked at baseline are not changes made by the run,
 * unless they are pollution, which is always reported.
 */
export async function readWorktreeState(
  worktreePath: string,
  baseline: BaselineState,
  signal?: AbortSignal | undefined,
): Promise<WorktreeState> {
  const changes: WorktreeChange[] = [];
  for (const entry of await readStatus(worktreePath, signal)) {
    const kind = classify(entry.path);
    const preExisting =
      entry.status === UNTRACKED && baseline.untrackedFiles.has(entry.path);
    if (preExisting && kind !== "pollution") continue;
    changes.push({ path: entry.path, status: entry.status, kind });
  }

  const implementationPaths = changes
    .filter((c) => c.kind === "implementation")
    .map((c) => c.path);
  const pollutionDetails = changes
    .filter((c) => c.kind === "pollution")
    .map(
      (c) =>
        `Pollution file detected: "${c.path}" matches forbidden generated pattern.`,
    );

  return {
    changes,
    implementationPaths,
    hasImplementationChanges: implementationPaths.length > 0,
    hasPollution: pollutionDetails.length > 0,
    pollutionDetails,
  };
}

/** Where preparation records a run's baseline, inside its artifacts directory. */
export function baselinePathFor(artifactsDir: string): string {
  return path.join(artifactsDir, "baseline.json");
}

interface BaselineJson {
  trackedFiles: string[];
  untrackedFiles: string[];
}

export async function saveRecordedBaseline(
  baselineJsonPath: string,
  baseline: BaselineState,
  write: (
    path: string,
    content: string,
    encoding: "utf-8",
  ) => Promise<void> = writeFile,
): Promise<void> {
  const json: BaselineJson = {
    trackedFiles: Array.from(baseline.trackedFiles),
    untrackedFiles: Array.from(baseline.untrackedFiles),
  };
  await write(baselineJsonPath, JSON.stringify(json, null, 2), "utf-8");
}

/**
 * Load the baseline recorded at preparation. Never records a new one: a baseline
 * taken later would count the run's own changes as pre-existing.
 */
export async function loadRecordedBaseline(
  baselineJsonPath: string,
  read: (path: string, encoding: "utf-8") => Promise<string> = readFile,
): Promise<BaselineState> {
  let parsed: Partial<BaselineJson>;
  try {
    parsed = JSON.parse(await read(baselineJsonPath, "utf-8"));
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `No usable baseline recorded at ${baselineJsonPath}: ${reason}`,
    );
  }
  return {
    trackedFiles: new Set(parsed.trackedFiles ?? []),
    untrackedFiles: new Set(parsed.untrackedFiles ?? []),
  };
}
