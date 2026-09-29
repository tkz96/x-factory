// src/azure/pr.ts — Azure DevOps Pull Request creation domain service.
// STRICT SAFETY INVARIANT: X-Factory only creates pull requests and posts check statuses.
// X-Factory MUST NEVER merge, abandon, or close pull requests.

import { resolveAzureAuthHeader } from "./auth.js";

export interface CreateAzurePullRequestOptions {
  orgUrl: string;
  project: string;
  repoIdOrName: string;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  pat?: string;
  fetchFn?: typeof fetch;
}

export interface AzurePullRequestResult {
  ok: boolean;
  pullRequestId?: number | undefined;
  url?: string | undefined;
  error?: string | undefined;
}

/**
 * Format a git ref name into refs/heads/... format expected by Azure DevOps API.
 */
export function normalizeGitRef(branch: string): string {
  const trimmed = branch.trim();
  if (trimmed.startsWith("refs/heads/")) {
    return trimmed;
  }
  return `refs/heads/${trimmed}`;
}

/**
 * Create a new pull request in Azure DevOps.
 */
function parseAzureRepoCoords(options: {
  fetchFn?: typeof fetch | undefined;
  orgUrl?: string | undefined;
  project?: string | undefined;
  repoIdOrName?: string | undefined;
}) {
  const fetcher = options.fetchFn || globalThis.fetch;
  const orgUrl = (options.orgUrl || "").trim().replace(/\/+$/, "");
  const project = (options.project || "").trim();
  const repo = (options.repoIdOrName || "").trim();
  return { fetcher, orgUrl, project, repo };
}

/**
 * NOTE: X-Factory is strictly prohibited from closing, rejecting, or merging PRs.
 * This module does not provide any merge or close operations.
 */
export async function createAzurePullRequest(
  options: CreateAzurePullRequestOptions,
): Promise<AzurePullRequestResult> {
  const { fetcher, orgUrl, project, repo } = parseAzureRepoCoords(options);

  if (!orgUrl || !project || !repo) {
    return {
      ok: false,
      error:
        "Missing required Azure parameters (orgUrl, project, repoIdOrName).",
    };
  }

  const authHeader = await resolveAzureAuthHeader(options.pat);

  if (!authHeader) {
    return {
      ok: false,
      error: "Authentication required to create Azure pull request.",
    };
  }

  const endpoint = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?api-version=7.1`;

  const payload = {
    sourceRefName: normalizeGitRef(options.sourceBranch),
    targetRefName: normalizeGitRef(options.targetBranch),
    title: options.title,
    description: options.description,
  };

  try {
    const res = await fetcher(endpoint, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `Azure returned ${res.status}: ${errText}`,
      };
    }

    const data = (await res.json()) as {
      pullRequestId?: number;
      url?: string;
      _links?: { web?: { href?: string } };
      repository?: { webUrl?: string };
    };

    const pullRequestId = data.pullRequestId;
    // Azure returns web link in _links.web.href or repository.webUrl/pullrequest/{id}
    let webUrl = data._links?.web?.href || "";
    if (!webUrl && pullRequestId) {
      webUrl = `${orgUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${pullRequestId}`;
    }

    return {
      ok: true,
      pullRequestId,
      url: webUrl || data.url,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface ExistingAzurePullRequest {
  url: string;
  sourceRefName: string;
  targetRefName: string;
  status: string;
  lastMergeSourceCommit?: string;
}

/**
 * Query active PRs in Azure DevOps to discover an existing PR for the source branch.
 */
export async function findExistingAzurePullRequest(
  options: Pick<
    CreateAzurePullRequestOptions,
    "orgUrl" | "project" | "repoIdOrName" | "sourceBranch" | "pat" | "fetchFn"
  >,
): Promise<ExistingAzurePullRequest | null> {
  const { fetcher, orgUrl, project, repo } = parseAzureRepoCoords(options);

  if (!orgUrl || !project || !repo) {
    throw new Error("Missing Azure repository configuration.");
  }

  const authHeader = await resolveAzureAuthHeader(options.pat);
  if (!authHeader) {
    throw new Error("Missing Azure authentication.");
  }

  const sourceRef = encodeURIComponent(normalizeGitRef(options.sourceBranch));
  const endpoint = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/pullrequests?searchCriteria.sourceRefName=${sourceRef}&searchCriteria.status=active&api-version=7.1`;

  try {
    const res = await fetcher(endpoint, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(
        `Azure PR lookup failed with status ${res.status}: ${errText}`,
      );
    }

    const data = (await res.json()) as {
      value?: Array<{
        pullRequestId?: number;
        url?: string;
        _links?: { web?: { href?: string } };
        sourceRefName?: string;
        targetRefName?: string;
        status?: string;
        lastMergeSourceCommit?: { commitId?: string };
      }>;
    };

    const pr = data.value?.[0];
    if (pr) {
      const url =
        pr._links?.web?.href ||
        pr.url ||
        (pr.pullRequestId
          ? `${orgUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repo)}/pullrequest/${pr.pullRequestId}`
          : "");

      if (url) {
        return {
          url,
          sourceRefName: pr.sourceRefName || "",
          targetRefName: pr.targetRefName || "",
          status: pr.status || "",
          lastMergeSourceCommit: pr.lastMergeSourceCommit?.commitId || "",
        };
      }
    }

    return null;
  } catch (err) {
    throw new Error(
      `Azure PR lookup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
