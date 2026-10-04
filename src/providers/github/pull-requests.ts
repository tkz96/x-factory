// src/providers/github/pull-requests.ts — GitHub pull request creation and lookup (#138).

import type {
  CreatePullRequestInput,
  FindPullRequestInput,
  ProviderConfig,
  ProviderPullRequest,
} from "../contract.js";
import { detectGitHubConfigMismatch, resolveGitHubConfig } from "./config.js";
import { GitHubHttpError } from "./errors.js";
import { githubFetch, resolveGitHubHeaders } from "./http.js";
import { resolveRepoCoordinates } from "./urls.js";

interface RawBranchInfo {
  ref?: string;
  sha?: string;
}

interface RawPullRequest {
  html_url?: string;
  state?: string;
  head?: RawBranchInfo;
  base?: RawBranchInfo;
}

function parsePullRequestResponse(
  data: unknown,
  input: CreatePullRequestInput,
): ProviderPullRequest {
  const pr = (data && typeof data === "object" ? data : {}) as RawPullRequest;
  const head = pr.head || {};
  const base = pr.base || {};

  return {
    url: String(pr.html_url || ""),
    status: typeof pr.state === "string" ? pr.state : "open",
    sourceBranch: typeof head.ref === "string" ? head.ref : input.sourceBranch,
    targetBranch: typeof base.ref === "string" ? base.ref : input.targetBranch,
    ...(head.sha ? { lastMergeSourceCommit: String(head.sha) } : {}),
  };
}

/**
 * Creates a GitHub pull request using explicit provider credentials via the REST API.
 * Never executes CLI commands or ambient machine authentication.
 */
export async function createGitHubPullRequest(
  config: ProviderConfig,
  input: CreatePullRequestInput,
  fetchFn?: typeof fetch,
): Promise<ProviderPullRequest> {
  const mismatch = detectGitHubConfigMismatch(config);
  if (mismatch.mismatch) {
    throw new Error(mismatch.error);
  }

  const {
    token,
    owner: configOwner,
    repo: configRepo,
    baseUrl,
  } = resolveGitHubConfig(config);
  const { owner, repo } = resolveRepoCoordinates(input.repository, configOwner);
  const effectiveRepo = repo || configRepo;

  if (!owner || !effectiveRepo) {
    throw new Error(
      `Cannot create GitHub pull request: repository coordinates (${input.repository}) are incomplete.`,
    );
  }

  if (!token) {
    throw new GitHubHttpError(
      "No GitHub token configured for pull request creation.",
      {
        status: 401,
        headers: new Headers(),
      },
    );
  }

  const root = baseUrl || "https://api.github.com";
  const endpoint = `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(effectiveRepo)}/pulls`;

  const res = await githubFetch(endpoint, {
    method: "POST",
    headers: resolveGitHubHeaders(token),
    body: JSON.stringify({
      title: input.title,
      body: input.description,
      head: input.sourceBranch,
      base: input.targetBranch,
    }),
    fetchFn,
  });

  return parsePullRequestResponse(res.data, input);
}

/**
 * Finds an existing pull request for the specified branch using the REST API.
 * Never executes CLI commands.
 */
export async function findExistingGitHubPullRequest(
  config: ProviderConfig,
  input: FindPullRequestInput,
  fetchFn?: typeof fetch,
): Promise<ProviderPullRequest | null> {
  const mismatch = detectGitHubConfigMismatch(config);
  if (mismatch.mismatch) {
    throw new Error(mismatch.error);
  }

  const {
    token,
    owner: configOwner,
    repo: configRepo,
    baseUrl,
  } = resolveGitHubConfig(config);
  const { owner, repo } = resolveRepoCoordinates(input.repository, configOwner);
  const effectiveRepo = repo || configRepo;

  if (!token) {
    throw new GitHubHttpError(
      "GitHub authentication failed: personal access token is required for pull requests.",
      {
        status: 401,
        headers: new Headers(),
      },
    );
  }

  if (!owner || !effectiveRepo) {
    throw new Error(
      `Unable to determine owner/repo for pull request: owner="${owner}", repo="${effectiveRepo}".`,
    );
  }

  const root = baseUrl || "https://api.github.com";
  const endpoint = `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(effectiveRepo)}/pulls?head=${encodeURIComponent(`${owner}:${input.sourceBranch}`)}&state=all`;

  let res: Awaited<ReturnType<typeof githubFetch>>;
  try {
    res = await githubFetch(endpoint, {
      headers: resolveGitHubHeaders(token),
      fetchFn,
    });
  } catch (err: unknown) {
    if (
      (err instanceof GitHubHttpError && err.status === 404) ||
      (typeof err === "object" &&
        err !== null &&
        "status" in err &&
        (err as { status: unknown }).status === 404)
    ) {
      return null;
    }
    throw err;
  }

  const pulls = (Array.isArray(res.data) ? res.data : []) as RawPullRequest[];
  const match = pulls.find((p) => p.head?.ref === input.sourceBranch);

  if (match) {
    const head = match.head || {};
    const base = match.base || {};
    return {
      url: String(match.html_url || ""),
      status: match.state || "open",
      sourceBranch: head.ref || input.sourceBranch,
      targetBranch: base.ref || "main",
      ...(head.sha ? { lastMergeSourceCommit: String(head.sha) } : {}),
    };
  }

  return null;
}
