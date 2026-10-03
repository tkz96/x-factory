// src/providers/github-module.ts — GitHub provider module conforming to the provider contract (#138).
//
// Implements GitHub integration for tracking and git-host roles:
// - Full Zod configSchema with secret metadata and envKey routing
// - Provider verification with HTTP probing and nested-config ambiguity detection (#129)
// - Normalized error envelope mapping with 403 rate-limit disambiguation (#129)
// - Quick-URL parser resolving github.com/owner/repo
// - Create-only pull request creation (REST API primary with gh CLI fallback)
// - Repository and issue listing

import { z } from "zod/v4";
import { execCommand } from "../proc.js";
import type {
  CreatePullRequestInput,
  FindPullRequestInput,
  Provider,
  ProviderConfig,
  ProviderError,
  ProviderErrorContext,
  ProviderPullRequest,
  ProviderRepository,
  TicketQueryOptions,
  TrackerTicket,
  VerificationResult,
} from "./contract.js";
import {
  isProviderError,
  PR_CREATE_ONLY,
  REQUIRED_WORKFLOW_LABEL,
} from "./contract.js";

// ---------------------------------------------------------------------------
// Configuration Schema (#128, #131)
// ---------------------------------------------------------------------------

export const gitHubConfigSchema = z.object({
  token: z.string().min(1).meta({
    label: "Personal Access Token",
    uiType: "secret",
    secret: true,
    envKey: "GITHUB_TOKEN",
    placeholder: "ghp_...",
    help: "GitHub personal access token or fine-grained token with repo scope.",
  }),
  owner: z.string().min(1).optional().meta({
    label: "Owner / Organization",
    uiType: "text",
    placeholder: "octocat",
    help: "GitHub user or organization login.",
  }),
  repo: z.string().min(1).optional().meta({
    label: "Repository",
    uiType: "text",
    placeholder: "hello-world",
    help: "Repository name.",
  }),
});

export type GitHubConfig = z.infer<typeof gitHubConfigSchema>;

// ---------------------------------------------------------------------------
// Nested-Config Ambiguity Detection (#129, P0 fix)
// ---------------------------------------------------------------------------

export interface ResolvedGitHubConfig {
  token: string;
  owner?: string;
  repo?: string;
}

/**
 * Parses GitHub URLs into owner and repo coordinates.
 */
function extractFromGitHubUrl(
  urlStr: string,
): { owner?: string; repo?: string } | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;

  // Match https://github.com/owner/repo, http://github.com/owner/repo,
  // git@github.com:owner/repo.git, or bare github.com/owner/repo
  const match =
    /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|(?:git@)?github\.com:)([^/\s]+)(?:\/([^/\s#?]+?))?(?:\.git|\/)?(?:[?#].*)?$/i.exec(
      trimmed,
    );

  if (!match) return null;
  const owner = match[1]?.trim();
  const repo = match[2]?.trim()?.replace(/\.git$/i, "");
  return {
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
  };
}

/**
 * Collects and detects conflicting configuration values across flat, nested,
 * role-specific, or legacy configuration fields. Distinct values for the same
 * semantic property trigger an ambiguity error to prevent silent collapsing.
 */
export function resolveGitHubConfig(
  rawConfig: Record<string, unknown>,
): ResolvedGitHubConfig {
  const tokenCandidates = new Set<string>();
  const ownerCandidates = new Map<string, string>(); // normalized -> original
  const repoCandidates = new Map<string, string>(); // normalized -> original

  function addToken(val: unknown) {
    if (typeof val === "string" && val.trim().length > 0) {
      tokenCandidates.add(val.trim());
    }
  }

  function addOwner(val: unknown) {
    if (typeof val === "string" && val.trim().length > 0) {
      const trimmed = val.trim();
      const norm = trimmed.toLowerCase();
      if (!ownerCandidates.has(norm)) {
        ownerCandidates.set(norm, trimmed);
      }
    }
  }

  function addRepo(val: unknown) {
    if (typeof val === "string" && val.trim().length > 0) {
      const trimmed = val.trim();
      const norm = trimmed.toLowerCase();
      if (!repoCandidates.has(norm)) {
        repoCandidates.set(norm, trimmed);
      }
    }
  }

  function inspectObject(obj: unknown) {
    if (typeof obj !== "object" || obj === null) return;
    const rec = obj as Record<string, unknown>;

    // Direct token fields
    addToken(rec.token);
    addToken(rec.pat);

    // Direct owner / org fields
    addOwner(rec.owner);
    addOwner(rec.organization);
    addOwner(rec.repoOwner);

    // Direct repo fields
    addRepo(rec.repo);
    addRepo(rec.repository);

    // Project field might be "repo" or "owner/repo"
    if (typeof rec.project === "string" && rec.project.trim().length > 0) {
      const p = rec.project.trim();
      if (p.includes("/")) {
        const parts = p.split("/");
        if (parts[0]) addOwner(parts[0]);
        if (parts[1]) addRepo(parts[1]);
      } else {
        addRepo(p);
      }
    }

    // URL fields
    const urlVal = rec.orgUrl ?? rec.url ?? rec.webUrl ?? rec.remoteUrl;
    if (typeof urlVal === "string") {
      const extracted = extractFromGitHubUrl(urlVal);
      if (extracted?.owner) addOwner(extracted.owner);
      if (extracted?.repo) addRepo(extracted.repo);
    }
  }

  // Inspect top-level
  inspectObject(rawConfig);

  // Inspect nested containers (e.g. tracker, gitHost, config, connection)
  const nestedKeys = ["tracker", "gitHost", "config", "connection"];
  for (const key of nestedKeys) {
    if (key in rawConfig) {
      inspectObject(rawConfig[key]);
    }
  }

  // Ambiguity verification: token
  if (tokenCandidates.size > 1) {
    throw new Error(
      `Ambiguous configuration: conflicting token values detected across configuration fields.`,
    );
  }

  // Ambiguity verification: owner
  if (ownerCandidates.size > 1) {
    const list = [...ownerCandidates.values()].map((v) => `"${v}"`).join(", ");
    throw new Error(
      `Ambiguous configuration: conflicting owner/organization values detected (${list}). Distinct configurations must not be silently collapsed.`,
    );
  }

  // Ambiguity verification: repo
  if (repoCandidates.size > 1) {
    const list = [...repoCandidates.values()].map((v) => `"${v}"`).join(", ");
    throw new Error(
      `Ambiguous configuration: conflicting repository values detected (${list}). Distinct configurations must not be silently collapsed.`,
    );
  }

  const token = tokenCandidates.values().next().value ?? "";
  const owner = ownerCandidates.values().next().value;
  const repo = repoCandidates.values().next().value;

  return {
    token,
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
  };
}

// ---------------------------------------------------------------------------
// HTTP Helpers
// ---------------------------------------------------------------------------

function makeHeaders(token: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "x-factory",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export interface GitHubHttpError extends Error {
  status: number;
  headers?: Headers;
  response?: Response;
}

function createHttpError(message: string, res: Response): GitHubHttpError {
  const err = new Error(message) as GitHubHttpError;
  err.status = res.status;
  err.headers = res.headers;
  err.response = res;
  return err;
}

function parseOwnerAndRepo(
  config: ProviderConfig,
  repositoryInput?: string,
): { owner: string | undefined; repo: string | undefined; token: string } {
  const resolved = resolveGitHubConfig(config);
  let owner = resolved.owner;
  let repo = resolved.repo;

  if (repositoryInput?.includes("/")) {
    const parts = repositoryInput.split("/");
    owner = parts[0];
    repo = parts[1];
  } else if (!repo && repositoryInput) {
    repo = repositoryInput;
  }

  return { owner, repo, token: resolved.token };
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export type GitHubFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface GitHubModuleDeps {
  execCommand: typeof execCommand;
  fetch?: GitHubFetch;
}

export const defaultGitHubDeps: GitHubModuleDeps = {
  execCommand,
};

export class GitHubProvider implements Provider<"github"> {
  public readonly id = "github" as const;
  public readonly displayName = "GitHub";
  public readonly roles = ["tracker", "gitHost"] as const;
  public readonly iconRef = "provider-github";
  public readonly configSchema = gitHubConfigSchema;

  constructor(private readonly deps: GitHubModuleDeps = defaultGitHubDeps) {}

  private get fetch(): GitHubFetch {
    return this.deps.fetch ?? globalThis.fetch;
  }

  /**
   * Probes credentials and verifies scopes/capabilities against GitHub REST API.
   * Enforces nested-config ambiguity check (#129).
   */
  async verifyCredentials(config: ProviderConfig): Promise<VerificationResult> {
    const resolved = resolveGitHubConfig(config);

    if (!resolved.token) {
      const err = new Error(
        "GitHub Personal Access Token is required.",
      ) as GitHubHttpError;
      err.status = 401;
      throw err;
    }

    const headers = makeHeaders(resolved.token);
    const userRes = await this.fetch("https://api.github.com/user", {
      headers,
    });

    if (!userRes.ok) {
      throw createHttpError(
        `GitHub authentication failed with status ${userRes.status}`,
        userRes,
      );
    }

    const warnings: VerificationResult["warnings"] = [];

    // Probe owner/org access if owner was provided
    if (resolved.owner) {
      let orgRes = await this.fetch(
        `https://api.github.com/orgs/${encodeURIComponent(resolved.owner)}`,
        { headers },
      );
      if (orgRes.status === 404) {
        orgRes = await this.fetch(
          `https://api.github.com/users/${encodeURIComponent(resolved.owner)}`,
          { headers },
        );
      }

      if (!orgRes.ok) {
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "listRepositories",
        });
      }
    }

    // Probe repo access if owner and repo were provided
    if (resolved.owner && resolved.repo) {
      const repoRes = await this.fetch(
        `https://api.github.com/repos/${encodeURIComponent(resolved.owner)}/${encodeURIComponent(resolved.repo)}`,
        { headers },
      );
      if (!repoRes.ok) {
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "createPullRequest",
        });
      }
    }

    return {
      status: warnings.length > 0 ? "degraded" : "ok",
      warnings,
    };
  }

  /**
   * Normalizes raw error responses, headers, and codes into the contract error envelope.
   * Maps 403 with rate-limit headers to RATE_LIMITED with computed retryAfterMs;
   * maps 403 without rate-limit headers to PERMISSION (distinct from AUTH_INVALID).
   */
  toUserError(raw: unknown, context: ProviderErrorContext): ProviderError {
    if (isProviderError(raw)) {
      return {
        code: raw.code,
        context,
        ...(raw.retryAfterMs !== undefined && raw.retryAfterMs > 0
          ? { retryAfterMs: raw.retryAfterMs }
          : {}),
      };
    }

    let status: number | undefined;
    let headers: Headers | Record<string, string> | undefined;
    let message = "";

    if (raw instanceof Response) {
      status = raw.status;
      headers = raw.headers;
    } else if (typeof raw === "object" && raw !== null) {
      const rec = raw as Record<string, unknown>;
      if (typeof rec.status === "number") {
        status = rec.status;
      } else if (typeof rec.statusCode === "number") {
        status = rec.statusCode;
      }

      if (
        rec.headers instanceof Headers ||
        (typeof rec.headers === "object" && rec.headers !== null)
      ) {
        headers = rec.headers as Headers | Record<string, string>;
      }

      if (rec.response && typeof rec.response === "object") {
        const resp = rec.response as Record<string, unknown>;
        if (typeof resp.status === "number") status = resp.status;
        if (resp.headers)
          headers = resp.headers as Headers | Record<string, string>;
      }

      if (typeof rec.message === "string") {
        message = rec.message;
      }
    } else if (raw instanceof Error) {
      message = raw.message;
    }

    function getHeader(name: string): string | undefined {
      if (!headers) return undefined;
      const lower = name.toLowerCase();
      if (headers instanceof Headers) {
        return headers.get(lower) ?? headers.get(name) ?? undefined;
      }
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === lower && typeof v === "string") {
          return v;
        }
      }
      return undefined;
    }

    // 401 Unauthorized
    if (
      status === 401 ||
      message.includes("401") ||
      message.includes("Bad credentials")
    ) {
      return { code: "AUTH_INVALID", context };
    }

    // 404 Not Found
    if (
      status === 404 ||
      message.includes("404") ||
      message.includes("Not Found")
    ) {
      return { code: "NOT_FOUND", context };
    }

    // Compute retryAfterMs from headers if present
    function parseRetryAfter(): number | undefined {
      const retryAfterHeader = getHeader("retry-after");
      if (retryAfterHeader) {
        const seconds = parseInt(retryAfterHeader, 10);
        if (!Number.isNaN(seconds) && seconds > 0) {
          return seconds * 1000;
        }
        const dateMs = new Date(retryAfterHeader).getTime() - Date.now();
        if (!Number.isNaN(dateMs) && dateMs > 0) {
          return dateMs;
        }
      }

      const resetHeader = getHeader("x-ratelimit-reset");
      if (resetHeader) {
        const resetSec = parseInt(resetHeader, 10);
        if (!Number.isNaN(resetSec)) {
          const deltaMs = resetSec * 1000 - Date.now();
          if (deltaMs > 0) {
            return deltaMs;
          }
        }
      }

      return undefined;
    }

    // 429 Too Many Requests
    if (status === 429) {
      const retryAfterMs = parseRetryAfter();
      return {
        code: "RATE_LIMITED",
        context,
        ...(retryAfterMs !== undefined && retryAfterMs > 0
          ? { retryAfterMs }
          : {}),
      };
    }

    // 403 Forbidden: disambiguate rate limit vs permission error
    if (status === 403 || message.includes("403")) {
      const remaining = getHeader("x-ratelimit-remaining");
      const isRateLimited =
        remaining === "0" ||
        getHeader("retry-after") !== undefined ||
        message.toLowerCase().includes("rate limit") ||
        message.toLowerCase().includes("secondary rate limit");

      if (isRateLimited) {
        const retryAfterMs = parseRetryAfter();
        return {
          code: "RATE_LIMITED",
          context,
          ...(retryAfterMs !== undefined && retryAfterMs > 0
            ? { retryAfterMs }
            : {}),
        };
      }

      // 403 without rate limit headers: distinct permission error
      return { code: "PERMISSION", context };
    }

    return { code: "UNKNOWN", context };
  }

  /**
   * Parses quick URLs into a git-host config draft and inferred name (#127 §6).
   */
  parseQuickUrl(url: string) {
    const extracted = extractFromGitHubUrl(url);
    if (!extracted?.owner || !extracted?.repo) {
      return null;
    }
    return {
      configDraft: {
        owner: extracted.owner,
        repo: extracted.repo,
      },
      inferredName: extracted.repo,
    };
  }

  /**
   * Creates a GitHub Pull Request using REST API primary, falling back to gh CLI
   * only on REST failure. Honors PR_CREATE_ONLY policy (#127 §7).
   */
  async createPullRequest(
    config: ProviderConfig,
    input: CreatePullRequestInput,
  ): Promise<ProviderPullRequest> {
    // Assert create-only safety invariant
    if (PR_CREATE_ONLY !== "create-only") {
      throw new Error(
        "PR policy violation: only create operations are permitted.",
      );
    }

    const { owner, repo, token } = parseOwnerAndRepo(config, input.repository);
    if (!owner || !repo) {
      throw new Error(
        `Unable to determine owner/repo for pull request: owner="${owner}", repo="${repo}".`,
      );
    }

    let restError: unknown;

    // 1. Primary: REST API
    if (token) {
      try {
        const res = await this.fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
          {
            method: "POST",
            headers: {
              ...makeHeaders(token),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: input.title,
              body: input.description,
              head: input.sourceBranch,
              base: input.targetBranch,
            }),
          },
        );

        if (res.ok) {
          const data = (await res.json()) as {
            html_url: string;
            state?: string;
            head?: { ref?: string; sha?: string };
            base?: { ref?: string };
          };
          return {
            url: data.html_url,
            ...(data.state ? { status: data.state } : {}),
            sourceBranch: data.head?.ref ?? input.sourceBranch,
            targetBranch: data.base?.ref ?? input.targetBranch,
            ...(data.head?.sha ? { lastMergeSourceCommit: data.head.sha } : {}),
          };
        }

        restError = createHttpError(
          `GitHub PR creation failed with HTTP ${res.status}: ${await res.text()}`,
          res,
        );
      } catch (err) {
        restError = err;
      }
    } else {
      restError = new Error("No GitHub token configured for REST API.");
    }

    // 2. Fallback: gh CLI executable (only when REST failed)
    const ghArgs = [
      "pr",
      "create",
      "--repo",
      `${owner}/${repo}`,
      "--title",
      input.title,
      "--body",
      input.description,
      "--head",
      input.sourceBranch,
      "--base",
      input.targetBranch,
    ];

    const cliResult = await this.deps.execCommand("gh", ghArgs);
    if (cliResult.passed && cliResult.stdout) {
      const prUrl = cliResult.stdout.trim().split("\n")[0];
      if (prUrl) {
        return {
          url: prUrl,
          sourceBranch: input.sourceBranch,
          targetBranch: input.targetBranch,
        };
      }
    }

    // Throw the primary REST error if fallback also failed
    throw restError;
  }

  /**
   * Looks up an existing pull request for the given branch coordinate.
   */
  async findExistingPullRequest(
    config: ProviderConfig,
    input: FindPullRequestInput,
  ): Promise<ProviderPullRequest | null> {
    const { owner, repo, token } = parseOwnerAndRepo(config, input.repository);
    if (!owner || !repo) {
      return null;
    }
    if (token) {
      try {
        const res = await this.fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${input.sourceBranch}`)}&state=all`,
          { headers: makeHeaders(token) },
        );

        if (res.ok) {
          const pulls = (await res.json()) as Array<{
            html_url: string;
            state?: string;
            head?: { ref?: string; sha?: string };
            base?: { ref?: string };
          }>;
          const match = pulls.find((p) => p.head?.ref === input.sourceBranch);
          if (match) {
            return {
              url: match.html_url,
              ...(match.state ? { status: match.state } : {}),
              sourceBranch: match.head?.ref ?? input.sourceBranch,
              ...(match.base?.ref ? { targetBranch: match.base.ref } : {}),
              ...(match.head?.sha
                ? { lastMergeSourceCommit: match.head.sha }
                : {}),
            };
          }
          return null;
        }
      } catch {
        // Fallback to CLI
      }
    }

    // Fallback: gh CLI
    const cliResult = await this.deps.execCommand("gh", [
      "pr",
      "view",
      input.sourceBranch,
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "url,headRefName,headRefOid,baseRefName,state",
    ]);

    if (cliResult.passed && cliResult.stdout) {
      try {
        const data = JSON.parse(cliResult.stdout) as {
          url: string;
          state?: string;
          headRefName?: string;
          headRefOid?: string;
          baseRefName?: string;
        };
        if (data?.url) {
          return {
            url: data.url,
            ...(data.state ? { status: data.state } : {}),
            sourceBranch: data.headRefName ?? input.sourceBranch,
            ...(data.baseRefName ? { targetBranch: data.baseRefName } : {}),
            ...(data.headRefOid
              ? { lastMergeSourceCommit: data.headRefOid }
              : {}),
          };
        }
      } catch {
        // ignore JSON parse failure
      }
    }

    return null;
  }

  /**
   * Repository discovery for GitHub.
   */
  async listRepositories(
    config: ProviderConfig,
  ): Promise<ProviderRepository[]> {
    const resolved = resolveGitHubConfig(config);
    const headers = makeHeaders(resolved.token);

    const url = resolved.owner
      ? `https://api.github.com/orgs/${encodeURIComponent(resolved.owner)}/repos?per_page=100&type=all`
      : "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";

    let res = await this.fetch(url, { headers });
    if (res.status === 404 && resolved.owner) {
      res = await this.fetch(
        `https://api.github.com/users/${encodeURIComponent(resolved.owner)}/repos?per_page=100`,
        { headers },
      );
    }

    if (!res.ok) {
      throw createHttpError(
        `GitHub repository discovery failed with HTTP ${res.status}`,
        res,
      );
    }

    const repos = (await res.json()) as Array<{
      id: number | string;
      name: string;
      clone_url?: string;
      html_url?: string;
      default_branch?: string;
    }>;

    return repos.map((repo) => ({
      id: String(repo.id),
      name: repo.name,
      remote: repo.clone_url || repo.html_url || "",
      defaultBranch: repo.default_branch || "main",
      ...(repo.html_url ? { webUrl: repo.html_url } : {}),
    }));
  }

  /**
   * Ticket / Issue listing for GitHub.
   */
  async listTickets(
    config: ProviderConfig,
    options: TicketQueryOptions,
  ): Promise<TrackerTicket[]> {
    const resolved = resolveGitHubConfig(config);
    const owner = resolved.owner;
    const repo = resolved.repo;

    if (!owner || !repo) {
      throw new Error(
        `Listing tickets requires both owner and repo (received owner="${owner}", repo="${repo}").`,
      );
    }

    const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
    const headers = makeHeaders(resolved.token);

    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=50`;
    const res = await this.fetch(url, { headers });

    if (!res.ok) {
      throw createHttpError(
        `GitHub ticket query failed with HTTP ${res.status}`,
        res,
      );
    }

    const issues = (await res.json()) as Array<{
      number: number;
      title: string;
      body?: string | null;
      state: string;
      html_url: string;
      pull_request?: unknown;
      labels: Array<string | { name: string }>;
      updated_at?: string;
    }>;

    return issues
      .filter((item) => !item.pull_request)
      .map((item) => {
        const labelNames = item.labels.map((l) =>
          typeof l === "string" ? l : l.name,
        );
        return {
          id: String(item.number),
          title: item.title,
          description: item.body || "",
          acceptanceCriteria: [],
          provider: "github" as const,
          labels: labelNames,
          url: item.html_url,
          ...(item.updated_at ? { updatedAt: item.updated_at } : {}),
        };
      })
      .filter((ticket) =>
        ticket.labels.some((l) => l.toLowerCase() === label.toLowerCase()),
      );
  }
}

export const gitHubProvider = new GitHubProvider();
