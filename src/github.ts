// src/github.ts — GitHub CLI integration for delivery and pull request creation.

import { execStrict, execCommand } from "./proc.js";

export interface ExistingGitHubPullRequest {
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  state: string;
}

/**
 * Check if a PR already exists for the head branch. Returns PR metadata or null.
 */
export async function findExistingPullRequest(
  worktreePath: string,
  headBranch: string,
): Promise<ExistingGitHubPullRequest | null> {
  const result = await execCommand(
    "gh",
    [
      "pr",
      "view",
      headBranch,
      "--json",
      "url,headRefName,headRefOid,baseRefName,state",
    ],
    { cwd: worktreePath },
  );

  if (result.exitCode !== 0) {
    if (result.stderr.includes("no pull requests found")) {
      return null;
    }
    throw new Error(`GitHub PR lookup failed: exit code ${result.exitCode}. Error: ${result.stderr}`);
  }

  try {
    const data = JSON.parse(result.stdout) as ExistingGitHubPullRequest;
    if (data && data.url) {
      return data;
    }
    return null;
  } catch (err) {
    throw new Error(`GitHub PR lookup failed (invalid JSON): ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Create a GitHub Pull Request using gh CLI. Returns PR URL.
 */
export async function createPullRequest(
  worktreePath: string,
  title: string,
  body: string,
  baseBranch: string,
): Promise<string> {
  const result = await execStrict(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--base", baseBranch],
    { cwd: worktreePath },
  );
  return result.stdout.trim();
}
