// src/providers/github/pull-requests.ts — GitHub pull request creation and lookup (#138).

import {
  assertCreateOnlyInvariant,
  type CreatePullRequestInput,
  type FindPullRequestInput,
  type ProviderConfig,
  type ProviderPullRequest,
} from "../contract.js";
import type { HttpTransport } from "../http.js";
import { resolveGitHubConfig } from "./config.js";
import { GitHubHttpError } from "./errors.js";
import {
  DEFAULT_GITHUB_API_ROOT,
  githubFetch,
  resolveGitHubHeaders,
} from "./http.js";
import { resolveRepoCoordinates } from "./urls.js";

/** Enforce the contract create-only invariant inside the module itself (#141, Finding B). */
export function enforceGitHubPrCreateOnly(
  provider: Parameters<typeof assertCreateOnlyInvariant>[0],
): void {
  assertCreateOnlyInvariant(provider);
}

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

export interface PreparedGitHubPrContext {
  token: string;
  owner: string;
  repo: string;
  root: string;
}

/**
 * Extracts and validates shared PR context across creation and lookup (#141, Finding H).
 */
export function prepareGitHubPrContext(
  config: ProviderConfig,
  repositoryCoordinate: string,
): PreparedGitHubPrContext {
  const {
    token,
    owner: configOwner,
    repo: configRepo,
    baseUrl,
  } = resolveGitHubConfig(config);
  const { owner, repo } = resolveRepoCoordinates(
    repositoryCoordinate,
    configOwner,
  );
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
      `Cannot resolve GitHub repository coordinates (${repositoryCoordinate}): owner or repo is incomplete.`,
    );
  }

  const root = baseUrl || DEFAULT_GITHUB_API_ROOT;
  return { token, owner, repo: effectiveRepo, root };
}

function parsePullRequestResponse(
  data: unknown,
  input: CreatePullRequestInput,
): ProviderPullRequest {
  const pr = (data && typeof data === "object" ? data : {}) as RawPullRequest;
  const head = pr.head || {};
  const base = pr.base || {};

  const prUrl = typeof pr.html_url === "string" ? pr.html_url.trim() : "";
  if (!prUrl) {
    throw new Error(
      "GitHub pull request creation succeeded but the response did not include a valid PR URL (html_url missing or empty). The PR may exist — check the repository.",
    );
  }

  return {
    url: prUrl,
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
  fetchFn?: typeof fetch | HttpTransport | undefined,
  signal?: AbortSignal | undefined,
): Promise<ProviderPullRequest> {
  const { token, owner, repo, root } = prepareGitHubPrContext(
    config,
    input.repository,
  );
  const endpoint = `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`;

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
    signal,
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
  fetchFn?: typeof fetch | HttpTransport | undefined,
  signal?: AbortSignal | undefined,
): Promise<ProviderPullRequest | null> {
  const { token, owner, repo, root } = prepareGitHubPrContext(
    config,
    input.repository,
  );
  const endpoint = `${root}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${input.sourceBranch}`)}&state=all`;

  // All API errors propagate — including 404, which for GET /pulls means the
  // repository could not be resolved (bad config), not "no PR exists".
  // Only 200 + no matching item in the response list returns null.
  const res = await githubFetch(endpoint, {
    headers: resolveGitHubHeaders(token),
    fetchFn,
    signal,
  });

  if (!Array.isArray(res.data)) {
    throw new Error(
      "GitHub pull request lookup failed: expected an array of pull requests from the API response.",
    );
  }

  const pulls = res.data as RawPullRequest[];
  const match = pulls.find((p) => p.head?.ref === input.sourceBranch);

  if (match) {
    const prUrl =
      typeof match.html_url === "string" ? match.html_url.trim() : "";
    if (!prUrl) {
      throw new Error(
        "GitHub pull request lookup matched a pull request but the response did not include a valid PR URL (html_url missing or empty).",
      );
    }

    const head = match.head || {};
    const base = match.base || {};
    return {
      url: prUrl,
      status: match.state || "open",
      sourceBranch: head.ref || input.sourceBranch,
      ...(base.ref ? { targetBranch: base.ref } : {}),
      ...(head.sha ? { lastMergeSourceCommit: String(head.sha) } : {}),
    };
  }

  return null;
}
