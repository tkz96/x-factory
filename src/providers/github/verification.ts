// src/providers/github/verification.ts — GitHub credential and scope verification probes (#138).

import type {
  ProviderConfig,
  ScopeFinding,
  ScopeVerificationReport,
  VerificationResult,
  VerificationWarning,
} from "../contract.js";
import { detectGitHubConfigMismatch, resolveGitHubConfig } from "./config.js";
import { GitHubHttpError, toGitHubUserError } from "./errors.js";
import { githubFetch, resolveGitHubHeaders } from "./http.js";

function parseOAuthScopes(headers: Headers): string[] {
  const scopesHeader = headers.get("x-oauth-scopes");
  if (!scopesHeader) return [];
  return scopesHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasAnyScope(scopes: string[], targets: string[]): boolean {
  return targets.some((target) => scopes.includes(target));
}

/**
 * Verifies GitHub credentials via read-only API calls.
 * Never performs write requests or PR mutations during verification.
 */
async function probeOwnerRepos(
  root: string,
  owner: string,
  token: string,
  fetchFn?: typeof fetch,
): Promise<VerificationWarning | null> {
  try {
    await githubFetch(
      `${root}/orgs/${encodeURIComponent(owner)}/repos?per_page=1`,
      {
        headers: resolveGitHubHeaders(token),
        fetchFn,
      },
    );
    return null;
  } catch (orgErr) {
    if (
      typeof orgErr === "object" &&
      orgErr !== null &&
      "status" in orgErr &&
      (orgErr as { status: unknown }).status === 404
    ) {
      await githubFetch(`${root}/users/${encodeURIComponent(owner)}`, {
        headers: resolveGitHubHeaders(token),
        fetchFn,
      });
      return null;
    }
    if (
      typeof orgErr === "object" &&
      orgErr !== null &&
      "status" in orgErr &&
      (orgErr as { status: unknown }).status === 403
    ) {
      return {
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "listRepositories",
      };
    }
    throw orgErr;
  }
}

async function probeUserRepos(
  root: string,
  token: string,
  fetchFn?: typeof fetch,
): Promise<VerificationWarning | null> {
  try {
    await githubFetch(`${root}/user/repos?per_page=1`, {
      headers: resolveGitHubHeaders(token),
      fetchFn,
    });
    return null;
  } catch {
    return {
      kind: "CAPABILITY_UNCONFIRMED",
      capability: "listRepositories",
    };
  }
}

function checkScopeWarnings(headers: Headers): VerificationWarning[] {
  const scopes = parseOAuthScopes(headers);
  const hasScopesHeader = headers.has("x-oauth-scopes");

  if (hasScopesHeader) {
    if (!scopes.includes("repo")) {
      return [
        {
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "createPullRequest",
        },
      ];
    }
    return [];
  }

  // Fine-grained PAT: write capability cannot be confirmed without mutation
  return [
    {
      kind: "CAPABILITY_UNCONFIRMED",
      capability: "createPullRequest",
    },
  ];
}

async function probePublicOwner(
  root: string,
  owner: string,
  fetchFn?: typeof fetch,
): Promise<void> {
  try {
    await githubFetch(
      `${root}/orgs/${encodeURIComponent(owner)}/repos?per_page=1`,
      {
        headers: resolveGitHubHeaders(),
        fetchFn,
      },
    );
  } catch {
    await githubFetch(
      `${root}/users/${encodeURIComponent(owner)}/repos?per_page=1`,
      {
        headers: resolveGitHubHeaders(),
        fetchFn,
      },
    );
  }
}

/**
 * Verifies credentials and probes repository access without mutating PRs.
 */
export async function verifyGitHubCredentials(
  config: ProviderConfig,
  fetchFn?: typeof fetch,
): Promise<VerificationResult> {
  const mismatch = detectGitHubConfigMismatch(config);
  if (mismatch.mismatch) {
    throw new Error(mismatch.error);
  }

  const { token, owner, baseUrl } = resolveGitHubConfig(config);
  const root = baseUrl || "https://api.github.com";

  if (!token && !owner) {
    throw new GitHubHttpError(
      "GitHub authentication failed: no personal access token or organization specified.",
      {
        status: 401,
        headers: new Headers(),
      },
    );
  }

  const warnings: VerificationWarning[] = [];

  if (token) {
    const userRes = await githubFetch(`${root}/user`, {
      headers: resolveGitHubHeaders(token),
      fetchFn,
    });

    const repoWarning = owner
      ? await probeOwnerRepos(root, owner, token, fetchFn)
      : await probeUserRepos(root, token, fetchFn);

    if (repoWarning) {
      warnings.push(repoWarning);
    }

    warnings.push(...checkScopeWarnings(userRes.headers));
  } else if (owner) {
    await probePublicOwner(root, owner, fetchFn);
    warnings.push({
      kind: "CAPABILITY_UNCONFIRMED",
      capability: "createPullRequest",
    });
  }

  return {
    status: warnings.length > 0 ? "degraded" : "ok",
    warnings,
  };
}

/**
 * Inspects scopes associated with the GitHub token and reports privilege posture.
 */
export async function verifyGitHubScopes(
  config: ProviderConfig,
  fetchFn?: typeof fetch,
): Promise<ScopeVerificationReport> {
  const { token, baseUrl } = resolveGitHubConfig(config);
  const root = baseUrl || "https://api.github.com";

  if (!token) {
    return {
      findings: [
        { capability: "verifyScopes", status: "missing" },
        { capability: "listRepositories", status: "unconfirmed" },
        { capability: "listTickets", status: "unconfirmed" },
        { capability: "createPullRequest", status: "unconfirmed" },
      ],
      overPrivileged: false,
    };
  }

  let scopes: string[] = [];
  let hasScopesHeader = false;

  try {
    const userRes = await githubFetch(`${root}/user`, {
      headers: resolveGitHubHeaders(token),
      fetchFn,
    });
    hasScopesHeader = userRes.headers.has("x-oauth-scopes");
    scopes = parseOAuthScopes(userRes.headers);
  } catch (err) {
    throw toGitHubUserError(err, "VERIFY");
  }

  const findings: ScopeFinding[] = [];
  findings.push({ capability: "verifyScopes", status: "confirmed" });

  if (hasScopesHeader) {
    const hasRepo = hasAnyScope(scopes, ["repo", "public_repo"]);
    findings.push({
      capability: "listRepositories",
      status: hasRepo ? "confirmed" : "missing",
    });
    findings.push({
      capability: "listTickets",
      status: hasRepo ? "confirmed" : "missing",
    });
    findings.push({
      capability: "createPullRequest",
      status: scopes.includes("repo") ? "confirmed" : "unconfirmed",
    });
  } else {
    // Fine-grained PAT
    findings.push({ capability: "listRepositories", status: "confirmed" });
    findings.push({ capability: "listTickets", status: "confirmed" });
    findings.push({ capability: "createPullRequest", status: "unconfirmed" });
  }

  const overPrivileged = hasAnyScope(scopes, [
    "delete_repo",
    "admin:org",
    "admin:repo_hook",
    "workflow",
  ]);

  return {
    findings,
    overPrivileged,
  };
}
