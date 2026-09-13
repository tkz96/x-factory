// src/github.ts — GitHub CLI integration for delivery and pull request creation.

import { execStrict } from "./proc.js";

/**
 * Create a GitHub Pull Request using gh CLI. Returns PR URL.
 */
export async function createPullRequest(
  worktreePath: string,
  title: string,
  body: string,
  baseBranch: string
): Promise<string> {
  const result = await execStrict(
    "gh",
    ["pr", "create", "--title", title, "--body", body, "--base", baseBranch],
    { cwd: worktreePath }
  );
  return result.stdout.trim();
}
