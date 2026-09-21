// src/github.ts — GitHub CLI integration for delivery and pull request creation.

import { execStrict } from "./proc.js";

/**
 * Check if a PR already exists for the head branch. Returns PR URL or null.
 */
export async function findExistingPullRequest(
  worktreePath: string,
  headBranch: string,
): Promise<string | null> {
  try {
    const result = await execStrict(
      "gh",
      ["pr", "view", headBranch, "--json", "url", "-q", ".url"],
      { cwd: worktreePath },
    );
    const url = result.stdout.trim();
    return url || null;
  } catch {
    return null;
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
