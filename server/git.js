// server/git.js — Git and GitHub CLI operations for X-Factory runs.

import { execFile } from "node:child_process";
import { access, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Run a command and return { stdout, stderr }.
 * Rejects with a descriptive error on non-zero exit.
 */
function exec(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const message = `${cmd} ${args.join(" ")} failed (exit ${err.code}):\n${stderr || stdout}`;
        reject(new Error(message));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

/** Check whether a local branch exists. */
export async function branchExists(repoPath, branchName) {
  try {
    await exec("git", ["rev-parse", "--verify", `refs/heads/${branchName}`], repoPath);
    return true;
  } catch {
    return false;
  }
}

/** Create a new branch from baseBranch. */
export async function createBranch(repoPath, branchName, baseBranch) {
  if (await branchExists(repoPath, branchName)) {
    throw new Error(`Branch "${branchName}" already exists in ${repoPath}`);
  }
  await exec("git", ["branch", branchName, baseBranch], repoPath);
}

/**
 * Create a git worktree for the given branch.
 * Returns the absolute worktree path.
 */
export async function createWorktree(repoPath, branchName, runId) {
  const worktreePath = worktreeDir(repoPath, runId);
  await exec("git", ["worktree", "add", worktreePath, branchName], repoPath);
  return worktreePath;
}

/** Remove a worktree. Checks for uncommitted changes first. */
export async function removeWorktree(repoPath, worktreePath) {
  // Check for uncommitted changes in the worktree.
  try {
    const { stdout } = await exec("git", ["status", "--porcelain"], worktreePath);
    if (stdout.length > 0) {
      throw new Error(
        `Worktree ${worktreePath} has uncommitted changes. Clean it up manually or commit first.`
      );
    }
  } catch (err) {
    // If the worktree dir doesn't exist, the status check will fail — that's fine.
    if (!err.message.includes("uncommitted")) {
      // Worktree might already be gone.
    } else {
      throw err;
    }
  }
  await exec("git", ["worktree", "remove", worktreePath, "--force"], repoPath);
}

/** Stage everything and commit. */
export async function commitAll(worktreePath, message) {
  await exec("git", ["add", "-A"], worktreePath);
  // Check if there's anything to commit.
  try {
    const { stdout } = await exec("git", ["status", "--porcelain"], worktreePath);
    if (stdout.length === 0) {
      throw new Error("Nothing to commit — working tree is clean.");
    }
  } catch (err) {
    if (err.message.includes("Nothing to commit")) throw err;
    // Other errors from status are unexpected.
    throw err;
  }
  await exec("git", ["commit", "-m", message], worktreePath);
}

/** Push branch to origin. */
export async function push(worktreePath, branchName) {
  await exec("git", ["push", "-u", "origin", branchName], worktreePath);
}

/** Create a GitHub Pull Request using gh CLI. Returns the PR URL. */
export async function createPullRequest(worktreePath, title, body, baseBranch) {
  const { stdout } = await exec(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--base", baseBranch],
    worktreePath
  );
  // gh pr create prints the PR URL on success.
  return stdout;
}

/** Resolve the worktree directory path for a run. */
export function worktreeDir(repoPath, runId) {
  return path.join(repoPath, ".x-factory", "worktrees", runId);
}

/** Verify a directory exists and is a git repository. */
export async function validateRepo(repoPath) {
  try {
    await access(repoPath);
  } catch {
    throw new Error(`Repository path does not exist: ${repoPath}`);
  }
  try {
    await exec("git", ["rev-parse", "--git-dir"], repoPath);
  } catch {
    throw new Error(`Not a git repository: ${repoPath}`);
  }
}

/** Check if gh CLI is authenticated. */
export async function checkGhAuth() {
  try {
    await exec("gh", ["auth", "status"], ".");
    return true;
  } catch {
    return false;
  }
}
