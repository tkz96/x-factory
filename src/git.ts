// src/git.ts — Git CLI and GitHub CLI operations with worktrees, baseline tracking, and pollution guardrails.

import { access, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  getProjectWorktreesDir,
  getRunDir,
  getRunMarkerPath,
  getWorktreePath,
} from "./paths.js";
import {
  type BaselineState,
  checkPollution,
  recordBaseline,
} from "./pollution.js";
import { execCommand, execStrict } from "./proc.js";

// Re-export for backward compatibility
export { type BaselineState, checkPollution, recordBaseline };

export interface DiffResult {
  diff: string;
  filesChanged: string[];
}

/**
 * Check whether a local branch exists.
 */
export async function branchExists(
  repoPath: string,
  branchName: string,
): Promise<boolean> {
  const result = await execCommand(
    "git",
    ["rev-parse", "--verify", `refs/heads/${branchName}`],
    { cwd: repoPath },
  );
  return result.exitCode === 0;
}

/**
 * Create a new branch from baseBranch.
 */
export async function createBranch(
  repoPath: string,
  branchName: string,
  baseBranch: string,
): Promise<void> {
  if (await branchExists(repoPath, branchName)) {
    throw new Error(`Branch "${branchName}" already exists in ${repoPath}`);
  }
  await execStrict("git", ["branch", branchName, baseBranch], {
    cwd: repoPath,
  });
}

/**
 * Create a dedicated git worktree outside the target repo:
 * ~/.x-factory/projects/<projectId>/worktrees/<runId>
 *
 * Writes the .xfactory-run marker into the run's artifacts directory
 * (~/.x-factory/projects/<projectId>/runs/<runId>/.xfactory-run)
 * so the worktree remains 100% clean and free of runtime metadata.
 */
export async function createWorktree(
  repoPath: string,
  branchName: string,
  projectId: string,
  runId: string,
): Promise<string> {
  const worktreePath = getWorktreePath(projectId, runId);
  await ensureDir(getProjectWorktreesDir(projectId));

  // Add git worktree
  await execStrict("git", ["worktree", "add", worktreePath, branchName], {
    cwd: repoPath,
  });

  // Write .xfactory-run marker in the run artifacts directory (outside worktree)
  const runDir = getRunDir(projectId, runId);
  await ensureDir(runDir);
  const markerPath = getRunMarkerPath(projectId, runId);
  const markerData = {
    runId,
    projectId,
    createdAt: new Date().toISOString(),
    pid: process.pid,
    worktreePath,
  };
  await writeFile(markerPath, JSON.stringify(markerData, null, 2), "utf-8");

  return worktreePath;
}

/**
 * Remove a git worktree safely.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force = true,
): Promise<void> {
  const args = ["worktree", "remove", worktreePath];
  if (force) args.push("--force");
  await execStrict("git", args, { cwd: repoPath });
}

/**
 * Non-destructively inspect and report any stale worktrees on server startup.
 * Never deletes anything automatically to prevent accidental data loss.
 */
export async function reportStaleWorktrees(
  projectId: string,
): Promise<string[]> {
  const worktreesDir = getProjectWorktreesDir(projectId);
  try {
    await access(worktreesDir);
  } catch {
    return [];
  }

  const entries = await readdir(worktreesDir, { withFileTypes: true });
  const staleWorktrees: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const runId = entry.name;
      const markerPath = getRunMarkerPath(projectId, runId);
      try {
        await access(markerPath);
      } catch {
        // Missing marker or orphan
        staleWorktrees.push(path.join(worktreesDir, runId));
      }
    }
  }

  return staleWorktrees;
}

/**
 * Extract full git diff and list of changed files compared to target.
 */
export async function getDiff(
  worktreePath: string,
  baseBranch?: string,
): Promise<DiffResult> {
  const target = baseBranch ? `origin/${baseBranch}...HEAD` : "HEAD";

  // Diff text (staged and unstaged against target)
  const diffResult = await execCommand("git", ["diff", target], {
    cwd: worktreePath,
  });
  const stagedDiffResult = await execCommand("git", ["diff", "--cached"], {
    cwd: worktreePath,
  });
  const fullDiff = [stagedDiffResult.stdout, diffResult.stdout]
    .filter(Boolean)
    .join("\n")
    .trim();

  // Changed files
  const nameResult = await execCommand(
    "git",
    ["status", "--porcelain", "-uall"],
    {
      cwd: worktreePath,
    },
  );
  const filesChanged: string[] = [];

  for (const line of nameResult.stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.includes(".git")) {
      filesChanged.push(trimmed.slice(3).trim());
    }
  }

  return {
    diff: fullDiff,
    filesChanged: Array.from(new Set(filesChanged)),
  };
}

/**
 * Safely commit all changes.
 * 1. Verifies no pollution against baseline.
 * 2. Verifies non-empty implementation diff exists.
 * 3. Stages all changes with git add -A.
 * 4. Commits with provided message.
 */
export async function safeCommitAll(
  worktreePath: string,
  message: string,
  baseline: BaselineState,
): Promise<void> {
  const pollution = await checkPollution(worktreePath, baseline);
  if (pollution.hasPollution) {
    throw new Error(
      `Cannot commit changes due to pollution:\n${pollution.details.join("\n")}`,
    );
  }

  const { diff, filesChanged } = await getDiff(worktreePath);
  if (!diff && filesChanged.length === 0) {
    throw new Error("Nothing to commit — working tree is clean.");
  }

  await execStrict("git", ["add", "-A"], { cwd: worktreePath });

  const statusCheck = await execStrict("git", ["status", "--porcelain"], {
    cwd: worktreePath,
  });
  if (statusCheck.stdout.length === 0) {
    throw new Error("Nothing to commit — working tree is clean after staging.");
  }

  await execStrict("git", ["commit", "-m", message], { cwd: worktreePath });
}

/**
 * Push branch to origin.
 */
export async function push(
  worktreePath: string,
  branchName: string,
): Promise<void> {
  await execStrict("git", ["push", "-u", "origin", branchName], {
    cwd: worktreePath,
  });
}

/**
 * Verify a directory exists, is a git repository, and is not already an active worktree.
 */
export async function validateRepo(repoPath: string): Promise<void> {
  try {
    await access(repoPath);
  } catch {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }

  const gitDirResult = await execCommand("git", ["rev-parse", "--git-dir"], {
    cwd: repoPath,
  });
  if (gitDirResult.exitCode !== 0) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}
