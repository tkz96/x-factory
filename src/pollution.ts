// src/pollution.ts — Workspace baseline tracking and dangerous pollution guardrails.

import { execStrict } from "./proc.js";

export interface BaselineState {
  trackedFiles: Set<string>;
  untrackedFiles: Set<string>;
}

export interface PollutionCheckResult {
  hasPollution: boolean;
  details: string[];
}

/**
 * Dangerous/generated pollution patterns.
 * Explicitly allows .env.example, .env.template, etc.
 */
export const POLLUTION_PATTERNS = [
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\..+\.local$/,
  /(^|\/)[^/]+\.log$/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)\.temp(\/|$)/,
  /(^|\/)\.cache(\/|$)/,
];

export function isPollutionPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  return POLLUTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Record baseline working tree state before implementation starts.
 * Excludes .git metadata.
 */
export async function recordBaseline(
  worktreePath: string,
): Promise<BaselineState> {
  const lsResult = await execStrict("git", ["ls-files"], { cwd: worktreePath });
  const trackedFiles = new Set(
    lsResult.stdout
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0 && !f.startsWith(".git")),
  );

  const statusResult = await execStrict(
    "git",
    ["status", "--porcelain", "-uall"],
    { cwd: worktreePath },
  );
  const untrackedFiles = new Set<string>();

  for (const line of statusResult.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("?? ")) {
      const relPath = trimmed.slice(3).trim();
      if (!relPath.startsWith(".git")) {
        untrackedFiles.add(relPath);
      }
    }
  }

  return { trackedFiles, untrackedFiles };
}

/**
 * Check for pollution against the pre-implementation baseline.
 * Rule:
 * 1. Existing tracked files: legitimate modification allowed.
 * 2. Existing untracked files: must not be modified or deleted.
 * 3. New files: allowed unless matching dangerous/generated pollution patterns.
 */
export async function checkPollution(
  worktreePath: string,
  baseline: BaselineState,
): Promise<PollutionCheckResult> {
  const statusResult = await execStrict(
    "git",
    ["status", "--porcelain", "-uall"],
    { cwd: worktreePath },
  );
  const details: string[] = [];

  for (const line of statusResult.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const status = trimmed.slice(0, 2);
    const relPath = trimmed.slice(3).trim();

    if (relPath.startsWith(".git")) continue;

    if (isPollutionPath(relPath)) {
      details.push(
        `Pollution file detected: "${relPath}" matches forbidden generated pattern.`,
      );
      continue;
    }

    if (baseline.untrackedFiles.has(relPath) && status !== "??") {
      details.push(
        `Pre-existing untracked file was modified: "${relPath}". Baseline untracked files must not be altered.`,
      );
    }
  }

  return {
    hasPollution: details.length > 0,
    details,
  };
}
