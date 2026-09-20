// src/azure/status.ts — Commit status publishing for Azure DevOps Git repositories.

import { resolveAzureAuthHeader } from "./auth.js";

type AzureCommitStatusState = "pending" | "succeeded" | "failed" | "error";

export interface PublishAzureCommitStatusOptions {
  orgUrl: string;
  project: string;
  repoIdOrName: string;
  commitSha: string;
  state: AzureCommitStatusState;
  description: string;
  targetUrl?: string | undefined;
  genre?: string | undefined;
  name?: string | undefined;
  pat?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

export interface AzureCommitStatusResult {
  ok: boolean;
  statusId?: number | undefined;
  error?: string | undefined;
}

/**
 * Publish a commit status badge to Azure DevOps using Code (Status) scope.
 * Safe and non-blocking: returns errors without throwing.
 */
export async function publishAzureCommitStatus(
  options: PublishAzureCommitStatusOptions,
): Promise<AzureCommitStatusResult> {
  const fetcher = options.fetchFn || globalThis.fetch;
  const orgUrl = (options.orgUrl || "").trim().replace(/\/+$/, "");
  const project = (options.project || "").trim();
  const repo = (options.repoIdOrName || "").trim();
  const commit = (options.commitSha || "").trim();

  if (!orgUrl || !project || !repo || !commit) {
    return {
      ok: false,
      error:
        "Missing required parameters for Azure commit status (orgUrl, project, repoIdOrName, commitSha).",
    };
  }

  const authHeader = await resolveAzureAuthHeader(options.pat);

  if (!authHeader) {
    return {
      ok: false,
      error: "Authentication required to publish Azure commit status.",
    };
  }

  const endpoint = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories/${encodeURIComponent(repo)}/commits/${encodeURIComponent(commit)}/statuses?api-version=7.1`;

  const payload = {
    state: options.state,
    description: (options.description || "").slice(0, 255),
    context: {
      name: options.name || "verification",
      genre: options.genre || "x-factory",
    },
    ...(options.targetUrl ? { targetUrl: options.targetUrl } : {}),
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
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      const errText = await res.text();
      return {
        ok: false,
        error: `Azure returned ${res.status}: ${errText}`,
      };
    }

    const data = (await res.json()) as { id?: number };
    return {
      ok: true,
      statusId: data.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
