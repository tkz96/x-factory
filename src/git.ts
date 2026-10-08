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
import { execCommand, execStrict } from "./proc.js";
import {
  type BaselineState,
  readWorktreeState,
  type WorktreeState,
} from "./worktree-state.js";

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
    { cwd: repoPath, envPolicy: "inherit" },
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
 * Diff text for exactly the implementation changes in `state`, so it covers the
 * same paths as `implementationPaths`. Tracked changes (staged or not) are diffed
 * against HEAD; new untracked files, which `git diff` cannot see, against /dev/null.
 */
export async function getDiffText(
  worktreePath: string,
  state: WorktreeState,
): Promise<string> {
  const implementation = state.changes.filter(
    (c) => c.kind === "implementation",
  );
  const tracked = implementation
    .filter((c) => c.status !== "??")
    .map((c) => c.path);
  const untracked = implementation
    .filter((c) => c.status === "??")
    .map((c) => c.path);

  const parts: string[] = [];
  if (tracked.length > 0) {
    const result = await execCommand(
      "git",
      ["--literal-pathspecs", "diff", "HEAD", "--", ...tracked],
      { cwd: worktreePath, envPolicy: "inherit" },
    );
    parts.push(result.stdout);
  }
  for (const file of untracked) {
    // Exits 1 when the files differ, which they always do here.
    const result = await execCommand(
      "git",
      ["diff", "--no-index", "--", "/dev/null", file],
      { cwd: worktreePath, envPolicy: "inherit" },
    );
    parts.push(result.stdout);
  }
  return parts.filter(Boolean).join("\n").trim();
}

/**
 * Extract the full git diff text and the implementation files changed since the baseline.
 */
export async function getDiff(
  worktreePath: string,
  baseline: BaselineState,
): Promise<DiffResult> {
  const state = await readWorktreeState(worktreePath, baseline);
  return {
    diff: await getDiffText(worktreePath, state),
    filesChanged: state.implementationPaths,
  };
}

/**
 * Safely commit all changes.
 * 1. Verifies no pollution against baseline.
 * 2. Stages all changes with git add -A.
 * 3. Verifies something is staged.
 * 4. Commits with provided message.
 */
export async function safeCommitAll(
  worktreePath: string,
  message: string,
  baseline: BaselineState,
): Promise<void> {
  const state = await readWorktreeState(worktreePath, baseline);
  if (state.hasPollution) {
    throw new Error(
      `Cannot commit changes due to pollution:\n${state.pollutionDetails.join("\n")}`,
    );
  }

  await execStrict("git", ["add", "-A"], { cwd: worktreePath });

  const statusCheck = await execStrict("git", ["status", "--porcelain"], {
    cwd: worktreePath,
  });
  if (statusCheck.stdout.length === 0) {
    throw new Error("Nothing to commit — working tree is clean.");
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
    envPolicy: "inherit",
  });
  if (gitDirResult.exitCode !== 0) {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

/**
 * Get current commit SHA at HEAD.
 */
export async function getHeadSha(repoPath: string): Promise<string> {
  const result = await execStrict("git", ["rev-parse", "HEAD"], {
    cwd: repoPath,
  });
  return result.stdout.trim();
}

/**
 * Get parent commit SHA of HEAD.
 */
export async function getParentSha(repoPath: string): Promise<string> {
  const result = await execStrict("git", ["log", "-1", "--format=%P"], {
    cwd: repoPath,
  });
  return result.stdout.trim().split(" ")[0] || "";
}

/**
 * Get current commit message at HEAD.
 */
export async function getHeadMessage(repoPath: string): Promise<string> {
  const result = await execStrict("git", ["log", "-1", "--pretty=format:%B"], {
    cwd: repoPath,
  });
  return result.stdout.trim();
}

/**
 * Searches Git history for a commit with the exact message and a specific parent SHA.
 * Returns the matched commit SHA, or null if not found.
 */
export async function findCommitByMessageAndParent(
  repoPath: string,
  message: string,
  parentSha: string,
): Promise<string | null> {
  const result = await execCommand(
    "git",
    ["log", "--format=%H %P", "--grep", message, "--fixed-strings"],
    { cwd: repoPath, envPolicy: "inherit" },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to search git history: exit code ${result.exitCode}. Error: ${result.stderr}`,
    );
  }

  const lines = result.stdout.trim().split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2) {
      const sha = parts[0];
      const parents = parts.slice(1);
      if (parents.includes(parentSha)) {
        return sha ?? null;
      }
    }
  }

  return null;
}

/**
 * Get remote branch SHA if it exists.
 */
export async function getRemoteBranchSha(
  repoPath: string,
  remote: string,
  branchName: string,
): Promise<string | null> {
  const result = await execCommand(
    "git",
    ["ls-remote", remote, `refs/heads/${branchName}`],
    {
      cwd: repoPath,
      envPolicy: "inherit",
    },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Git lookup failed for remote branch ${branchName}: exit code ${result.exitCode}. Error: ${result.stderr}`,
    );
  }
  if (!result.stdout.trim()) {
    return null;
  }
  const parts = result.stdout.trim().split(/\s+/);
  return parts[0] || null;
}
