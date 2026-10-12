// src/providers/github/closing-reference.ts — the pull request line that
// closes the GitHub issue a run was started from.

import type {
  ClosingReferenceInput,
  ClosingReferenceSide,
} from "../contract.js";

/** `owner/repo` for one side, or "" when the owner is not known. */
function coordinate({ config, repository }: ClosingReferenceSide): string {
  const repo = repository.trim();
  if (repo.includes("/")) return repo;
  const owner = typeof config.repoOwner === "string" ? config.repoOwner : "";
  return owner.trim() && repo ? `${owner.trim()}/${repo}` : "";
}

/**
 * `Closes #1` for an issue in the pull request's repository, `Closes
 * owner/repo#1` for one in another; `null` for a ticket that is not a GitHub
 * issue (`GH-<number>`).
 */
export function githubClosingReference(
  input: ClosingReferenceInput,
): string | null {
  const issue = /^GH-(\d+)$/.exec(input.ticketId)?.[1];
  if (!issue) return null;
  const issueRepo = coordinate(input.tracker);
  const prRepo = coordinate(input.gitHost);
  if (!issueRepo || issueRepo.toLowerCase() === prRepo.toLowerCase()) {
    return `Closes #${issue}`;
  }
  return `Closes ${issueRepo}#${issue}`;
}
