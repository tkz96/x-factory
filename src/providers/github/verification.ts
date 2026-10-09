// src/providers/github/verification.ts — GitHub credential and scope verification probes (#138).

import type {
  ProviderConfig,
  ScopeFinding,
  ScopeVerificationReport,
  VerificationResult,
  VerificationWarning,
} from "../contract.js";
import { resolveGitHubConfig } from "./config.js";
import { GitHubHttpError, toGitHubUserError } from "./errors.js";
import {
  DEFAULT_GITHUB_API_ROOT,
  githubFetch,
  resolveGitHubHeaders,
} from "./http.js";

interface GitHubTransport {
  root: string;
  token?: string | undefined;
  fetchFn?: typeof fetch | undefined;
}

function parseOAuthScopes(headers: Headers): string[] {
  const scopesHeader = headers.get("x-oauth-scopes");
  if (!scopesHeader) return [];
  return scopesHeader
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const OVER_PRIVILEGED_SCOPES = [
  "delete_repo",
  "admin:org",
  "admin:repo_hook",
] as const;

function hasAnyScope(scopes: string[], targets: readonly string[]): boolean {
  return targets.some((target) => scopes.includes(target));
}

/**
 * Verifies GitHub credentials via read-only API calls.
 * Never performs write requests or PR mutations during verification.
 */
async function probeOwnerRepos(
  transport: GitHubTransport,
  owner: string,
): Promise<VerificationWarning | null> {
  const { root, token, fetchFn } = transport;
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
    if (orgErr instanceof GitHubHttpError && orgErr.status === 404) {
      await githubFetch(`${root}/users/${encodeURIComponent(owner)}`, {
        headers: resolveGitHubHeaders(token),
        fetchFn,
      });
      return null;
    }
    if (orgErr instanceof GitHubHttpError && orgErr.status === 403) {
      return {
        kind: "CAPABILITY_UNCONFIRMED",
        capability: "listRepositories",
      };
    }
    throw orgErr;
  }
}

async function probeUserRepos(
  transport: GitHubTransport,
): Promise<VerificationWarning | null> {
  const { root, token, fetchFn } = transport;
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
          missingScopes: ["repo"],
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
  transport: GitHubTransport,
  owner: string,
): Promise<void> {
  const { root, fetchFn } = transport;
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
  const { token, owner, baseUrl } = resolveGitHubConfig(config);
  const root = baseUrl || DEFAULT_GITHUB_API_ROOT;
  const transport: GitHubTransport = { root, token, fetchFn };

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
      ? await probeOwnerRepos(transport, owner)
      : await probeUserRepos(transport);

    if (repoWarning) {
      warnings.push(repoWarning);
    }

    warnings.push(...checkScopeWarnings(userRes.headers));

    const scopes = parseOAuthScopes(userRes.headers);
    const overPrivileged = hasAnyScope(scopes, OVER_PRIVILEGED_SCOPES);

    return {
      status: warnings.length > 0 ? "degraded" : "ok",
      warnings,
      ...(overPrivileged ? { overPrivileged: true } : {}),
    };
  } else if (owner) {
    await probePublicOwner(transport, owner);
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
  const root = baseUrl || DEFAULT_GITHUB_API_ROOT;

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
      status: scopes.includes("repo") ? "confirmed" : "missing",
    });
  } else {
    // Fine-grained PAT: absence of x-oauth-scopes header means capabilities cannot be confirmed from scope introspection.
    findings.push({ capability: "listRepositories", status: "unconfirmed" });
    findings.push({ capability: "listTickets", status: "unconfirmed" });
    findings.push({ capability: "createPullRequest", status: "unconfirmed" });
  }

  const overPrivileged = hasAnyScope(scopes, OVER_PRIVILEGED_SCOPES);

  return {
    findings,
    overPrivileged,
  };
}
