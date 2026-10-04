// src/providers/github-module.ts — GitHub provider module conforming to the provider contract (#138).
//
// Conforms to the unified Provider contract (#127, #134):
// - Declares Zod configSchema with presentation metadata (.meta()) and envKey routing.
// - Fixed P0 nested-config ambiguity detection: distinct configurations across
//   top-level and nested containers are detected and rejected rather than silently collapsed (#129).
// - Required capabilities: verifyCredentials (with header-introspection scope warnings) and toUserError.
// - Optional capabilities: verifyScopes, listRepositories, listTickets, parseQuickUrl,
//   createPullRequest, findExistingPullRequest.
// - Error mapping: 403 with rate-limit headers (x-ratelimit-remaining: 0 or retry-after) maps to
//   RATE_LIMITED with computed retryAfterMs; 403 without rate-limit headers maps to PERMISSION.
// - Pull request creation: REST API primary, fallback to gh CLI only on REST failure; adheres
//   strictly to PR_CREATE_ONLY invariant (create-only, no merge/close/delete capabilities).

import { z } from "zod/v4";
import type {
  CreatePullRequestInput,
  FindPullRequestInput,
  Provider,
  ProviderConfig,
  ProviderConfigFieldMeta,
  ProviderError,
  ProviderErrorContext,
  ProviderPullRequest,
  ProviderRepository,
  QuickUrlDraft,
  ScopeFinding,
  ScopeVerificationReport,
  TicketQueryOptions,
  TrackerTicket,
  VerificationResult,
  VerificationWarning,
} from "./contract.js";
import { PR_CREATE_ONLY, REQUIRED_WORKFLOW_LABEL } from "./contract.js";

// ---------------------------------------------------------------------------
// Configuration Schema with presentation metadata (#128, #131)
// ---------------------------------------------------------------------------

const tokenMeta: ProviderConfigFieldMeta = {
  label: "Personal Access Token",
  uiType: "secret",
  secret: true,
  envKey: "GITHUB_TOKEN",
  placeholder: "ghp_••••••••••••••••••••••••••••••••",
  help: "GitHub Personal Access Token with 'repo' scope.",
};

const repoOwnerMeta: ProviderConfigFieldMeta = {
  label: "Organization or User",
  uiType: "text",
  placeholder: "e.g. octocat or facebook",
  help: "GitHub organization or user account to discover repositories from.",
};

const repositoryMeta: ProviderConfigFieldMeta = {
  label: "Repository",
  uiType: "text",
  placeholder: "e.g. hello-world",
  help: "Optional repository name for issue tracking or targeted operations.",
};

export const githubConfigSchema = z.object({
  token: z.string().min(1).meta(tokenMeta),
  repoOwner: z.string().optional().meta(repoOwnerMeta),
  repository: z.string().optional().meta(repositoryMeta),
});

export type GitHubConfig = z.infer<typeof githubConfigSchema>;

/** Alias for compatibility */
export const gitHubConfigSchema = githubConfigSchema;

// ---------------------------------------------------------------------------
// HTTP Boundary & Error Types
// ---------------------------------------------------------------------------

export class GitHubHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  readonly responseBody?: unknown;
  readonly isRateLimit?: boolean | undefined;
  readonly retryAfterMs?: number | undefined;

  constructor(
    message: string,
    options: {
      status: number;
      headers: Headers;
      responseBody?: unknown;
      isRateLimit?: boolean | undefined;
      retryAfterMs?: number | undefined;
    },
  ) {
    super(message);
    this.name = "GitHubHttpError";
    this.status = options.status;
    this.headers = options.headers;
    this.responseBody = options.responseBody;
    this.isRateLimit = options.isRateLimit;
    this.retryAfterMs = options.retryAfterMs;
  }
}

export type CliCommandExecutor = (
  cmd: string,
  args: string[],
  options?: { timeoutMs?: number; cwd?: string },
) => Promise<{
  exitCode?: number;
  passed: boolean;
  stdout: string;
  stderr?: string;
}>;

export interface GitHubProviderDependencies {
  fetchFn?: typeof fetch;
  executor?: CliCommandExecutor;
}

// ---------------------------------------------------------------------------
// Nested-Config Ambiguity Detection (#129 P0 fix)
// ---------------------------------------------------------------------------

export interface ResolvedGitHubConfig {
  token: string;
  owner?: string;
  repo?: string;
}

/**
 * Parses GitHub URLs into owner and repo coordinates.
 */
export function extractFromGitHubUrl(
  urlStr: string,
): { owner?: string; repo?: string } | null {
  const trimmed = urlStr.trim();
  if (!trimmed) return null;

  // SSH style: git@github.com:owner/repo.git or github.com:owner/repo
  const sshMatch = trimmed.match(
    /^(?:git@)?github\.com:([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+?)(?:\.git)?$/i,
  );
  if (sshMatch?.[1] && sshMatch[2]) {
    return {
      owner: sshMatch[1],
      repo: sshMatch[2].replace(/\.git$/i, ""),
    };
  }

  // HTTP/HTTPS style or bare domain
  const httpMatch = trimmed.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9_.-]+)(?:\/([a-zA-Z0-9_.-]+?))?(?:\.git)?(?:\/.*)?$/i,
  );
  if (httpMatch?.[1]) {
    const owner = httpMatch[1];
    const repo = httpMatch[2] ? httpMatch[2].replace(/\.git$/i, "") : undefined;
    return {
      owner,
      ...(repo ? { repo } : {}),
    };
  }

  return null;
}

/**
 * Detects whether conflicting configuration values exist across top-level and nested
 * configuration objects (e.g. github, gitHost, tracker, connections).
 * Ensures distinct configurations are NEVER silently collapsed (#129).
 */
export function detectGitHubConfigMismatch(config: Record<string, unknown>): {
  mismatch: boolean;
  error?: string;
} {
  const candidateOrgs: Array<{ source: string; value: string }> = [];
  const candidateTokens: Array<{ source: string; value: string }> = [];
  const candidateRepos: Array<{ source: string; value: string }> = [];

  const inspect = (prefix: string, obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;

    for (const key of ["repoOwner", "owner", "organization", "org"]) {
      if (typeof rec[key] === "string" && (rec[key] as string).trim()) {
        candidateOrgs.push({
          source: `${prefix}${key}`,
          value: (rec[key] as string).trim(),
        });
      }
    }

    for (const key of [
      "token",
      "pat",
      "githubToken",
      "accessToken",
      "apiToken",
    ]) {
      if (typeof rec[key] === "string" && (rec[key] as string).trim()) {
        candidateTokens.push({
          source: `${prefix}${key}`,
          value: (rec[key] as string).trim(),
        });
      }
    }

    for (const key of ["repository", "repo"]) {
      if (typeof rec[key] === "string" && (rec[key] as string).trim()) {
        candidateRepos.push({
          source: `${prefix}${key}`,
          value: (rec[key] as string).trim(),
        });
      }
    }

    // Check project field (may be "repo" or "owner/repo")
    if (typeof rec.project === "string" && rec.project.trim()) {
      const p = rec.project.trim();
      if (p.includes("/")) {
        const parts = p.split("/").filter(Boolean);
        if (parts[0])
          candidateOrgs.push({
            source: `${prefix}project(owner)`,
            value: parts[0],
          });
        if (parts[1])
          candidateRepos.push({
            source: `${prefix}project(repo)`,
            value: parts[1],
          });
      } else {
        candidateRepos.push({ source: `${prefix}project`, value: p });
      }
    }

    // Check URL fields
    const urlVal = rec.orgUrl ?? rec.url ?? rec.webUrl ?? rec.remoteUrl;
    if (typeof urlVal === "string" && urlVal.trim()) {
      const extracted = extractFromGitHubUrl(urlVal);
      if (extracted?.owner)
        candidateOrgs.push({
          source: `${prefix}url(owner)`,
          value: extracted.owner,
        });
      if (extracted?.repo)
        candidateRepos.push({
          source: `${prefix}url(repo)`,
          value: extracted.repo,
        });
    }
  };

  inspect("", config);
  inspect("github.", config.github);
  inspect("gitHost.", config.gitHost);
  inspect("tracker.", config.tracker);
  inspect("config.", config.config);

  if (Array.isArray(config.connections)) {
    for (let i = 0; i < config.connections.length; i++) {
      const conn = config.connections[i];
      if (conn && typeof conn === "object") {
        const c = conn as Record<string, unknown>;
        if (c.providerId === "github" || !c.providerId) {
          inspect(`connections[${i}].config.`, c.config);
          inspect(`connections[${i}].`, c);
        }
      }
    }
  }

  // Check for mismatched org/owner names (case-insensitive for GitHub usernames/orgs)
  if (candidateOrgs.length > 1) {
    const first = candidateOrgs[0];
    if (first) {
      for (let i = 1; i < candidateOrgs.length; i++) {
        const next = candidateOrgs[i];
        if (next && first.value.toLowerCase() !== next.value.toLowerCase()) {
          return {
            mismatch: true,
            error: `Configuration mismatch: configured ${first.source} "${first.value}" and ${next.source} "${next.value}" are distinct configurations and cannot be conflated.`,
          };
        }
      }
    }
  }

  // Check for mismatched tokens
  if (candidateTokens.length > 1) {
    const first = candidateTokens[0];
    if (first) {
      for (let i = 1; i < candidateTokens.length; i++) {
        const next = candidateTokens[i];
        if (next && first.value !== next.value) {
          return {
            mismatch: true,
            error: `Configuration mismatch: conflicting token values detected across configuration fields ("${first.source}" vs "${next.source}"). Distinct configurations must not be silently collapsed.`,
          };
        }
      }
    }
  }

  // Check for mismatched repos
  if (candidateRepos.length > 1) {
    const first = candidateRepos[0];
    if (first) {
      for (let i = 1; i < candidateRepos.length; i++) {
        const next = candidateRepos[i];
        if (next && first.value.toLowerCase() !== next.value.toLowerCase()) {
          return {
            mismatch: true,
            error: `Configuration mismatch: configured ${first.source} "${first.value}" and ${next.source} "${next.value}" are distinct configurations and cannot be conflated.`,
          };
        }
      }
    }
  }

  return { mismatch: false };
}

/**
 * Resolves token, owner, and repo from flat or nested provider configuration.
 * Validates against ambiguous or conflicting inputs.
 */
export function resolveGitHubConfig(
  config: ProviderConfig,
): ResolvedGitHubConfig {
  const mismatch = detectGitHubConfigMismatch(config);
  if (mismatch.mismatch) {
    throw new Error(mismatch.error);
  }

  let token = "";
  let owner: string | undefined;
  let repo: string | undefined;

  const extract = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const rec = obj as Record<string, unknown>;

    if (!token) {
      for (const k of [
        "token",
        "pat",
        "githubToken",
        "accessToken",
        "apiToken",
      ]) {
        if (typeof rec[k] === "string" && (rec[k] as string).trim()) {
          token = (rec[k] as string).trim();
          break;
        }
      }
    }

    if (!owner) {
      for (const k of ["repoOwner", "owner", "organization", "org"]) {
        if (typeof rec[k] === "string" && (rec[k] as string).trim()) {
          owner = (rec[k] as string).trim();
          break;
        }
      }
    }

    if (!repo) {
      for (const k of ["repository", "repo"]) {
        if (typeof rec[k] === "string" && (rec[k] as string).trim()) {
          repo = (rec[k] as string).trim();
          break;
        }
      }
    }

    if (!repo && typeof rec.project === "string" && rec.project.trim()) {
      const p = rec.project.trim();
      if (p.includes("/")) {
        const parts = p.split("/").filter(Boolean);
        if (!owner && parts[0]) owner = parts[0];
        if (parts[1]) repo = parts[1];
      } else {
        repo = p;
      }
    }

    const urlVal = rec.orgUrl ?? rec.url ?? rec.webUrl ?? rec.remoteUrl;
    if (typeof urlVal === "string" && urlVal.trim()) {
      const extracted = extractFromGitHubUrl(urlVal);
      if (!owner && extracted?.owner) owner = extracted.owner;
      if (!repo && extracted?.repo) repo = extracted.repo;
    }
  };

  extract(config);
  extract(config.github);
  extract(config.gitHost);
  extract(config.tracker);
  extract(config.config);

  if (Array.isArray(config.connections)) {
    for (const conn of config.connections) {
      if (conn && typeof conn === "object") {
        const c = conn as Record<string, unknown>;
        if (c.providerId === "github" || !c.providerId) {
          extract(c.config);
          extract(c);
        }
      }
    }
  }

  // Fallback to environment variables if not provided
  if (!token && typeof process.env.GITHUB_TOKEN === "string") {
    token = process.env.GITHUB_TOKEN.trim();
  }
  if (!owner && typeof process.env.GITHUB_OWNER === "string") {
    owner = process.env.GITHUB_OWNER.trim();
  }

  return {
    token,
    ...(owner ? { owner } : {}),
    ...(repo ? { repo } : {}),
  };
}

export function resolveGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "x-factory",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function resolveRepoCoordinates(
  repository: string,
  defaultOwner?: string,
): { owner: string; repo: string } {
  const trimmed = repository.trim();
  if (trimmed.includes("/")) {
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.includes("github.com")
    ) {
      const parsed = extractFromGitHubUrl(trimmed);
      if (parsed?.owner && parsed.repo) {
        return { owner: parsed.owner, repo: parsed.repo };
      }
    }
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[parts.length - 2];
      const repo = parts[parts.length - 1]?.replace(/\.git$/i, "");
      if (owner && repo) {
        return {
          owner,
          repo,
        };
      }
    }
  }

  if (!defaultOwner) {
    throw new Error(
      `Cannot resolve GitHub repository "${repository}": no owner or organization specified.`,
    );
  }

  return {
    owner: defaultOwner,
    repo: trimmed.replace(/\.git$/i, ""),
  };
}

// ---------------------------------------------------------------------------
// Rate Limit & Retry Helpers
// ---------------------------------------------------------------------------

export function parseGitHubRetryAfter(
  headers: Headers | Record<string, string>,
): number | undefined {
  function getHeader(name: string): string | undefined {
    if (headers instanceof Headers) {
      const val = headers.get(name);
      return val !== null ? val : undefined;
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower && typeof v === "string") {
        return v;
      }
    }
    return undefined;
  }

  const retryAfter = getHeader("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter.trim());
    if (!Number.isNaN(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
    const dateMs = Date.parse(retryAfter.trim());
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) return Math.round(diff);
    }
  }

  const resetHeader = getHeader("x-ratelimit-reset");
  if (resetHeader) {
    const resetSec = Number(resetHeader.trim());
    if (!Number.isNaN(resetSec) && resetSec > 0) {
      const diff = resetSec * 1000 - Date.now();
      if (diff > 0) return Math.round(diff);
    }
  }

  return undefined;
}

export function isGitHubRateLimited(
  status: number,
  headers: Headers | Record<string, string>,
  bodyText?: string,
  bodyData?: unknown,
): boolean {
  if (status === 429) {
    return true;
  }

  function getHeader(name: string): string | undefined {
    if (headers instanceof Headers) {
      const val = headers.get(name);
      return val !== null ? val : undefined;
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower && typeof v === "string") {
        return v;
      }
    }
    return undefined;
  }

  if (status === 403) {
    const remaining = getHeader("x-ratelimit-remaining");
    if (remaining === "0") {
      return true;
    }
    if (getHeader("retry-after")) {
      return true;
    }
    const message =
      (bodyData && typeof bodyData === "object" && "message" in bodyData
        ? String((bodyData as Record<string, unknown>).message)
        : "") ||
      bodyText ||
      "";
    if (/rate limit|secondary rate/i.test(message)) {
      return true;
    }
  }

  return false;
}

/**
 * Internal fetch wrapper with rate-limit and error interpretation.
 */
export async function githubFetch(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string> | Headers;
    body?: string;
    fetchFn?: typeof fetch;
  } = {},
): Promise<{ status: number; text: string; data: unknown; headers: Headers }> {
  const fetcher = options.fetchFn || globalThis.fetch;
  const res = await fetcher(url, {
    method: options.method || "GET",
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body ? { body: options.body } : {}),
  });

  const headers = res.headers;
  const bodyText = await res.text();
  let data: unknown = null;
  if (bodyText.trim()) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      // non-JSON response
    }
  }

  if (!res.ok) {
    const isRate = isGitHubRateLimited(res.status, headers, bodyText, data);
    const retryAfterMs = parseGitHubRetryAfter(headers);
    throw new GitHubHttpError(
      `GitHub API request failed with status ${res.status}: ${bodyText.slice(0, 300)}`,
      {
        status: res.status,
        headers,
        responseBody: data,
        isRateLimit: isRate,
        ...(retryAfterMs !== undefined && retryAfterMs > 0
          ? { retryAfterMs }
          : {}),
      },
    );
  }

  return {
    status: res.status,
    text: bodyText,
    data,
    headers,
  };
}

// ---------------------------------------------------------------------------
// Error Normalization (toUserError)
// ---------------------------------------------------------------------------

/**
 * Normalizes provider-specific status/body/header semantics into the provider error envelope.
 * Strictly provider-neutral: No provider-generated message, body text, or header name crosses this boundary.
 */
export function toGitHubUserError(
  raw: unknown,
  context: ProviderErrorContext,
): ProviderError {
  if (
    raw &&
    typeof raw === "object" &&
    "code" in raw &&
    "context" in raw &&
    typeof (raw as Record<string, unknown>).code === "string" &&
    typeof (raw as Record<string, unknown>).context === "string"
  ) {
    return raw as ProviderError;
  }

  let status: number | undefined;
  let headers = new Headers();
  let isRateLimit = false;
  let retryAfterMs: number | undefined;
  let message = "";

  if (raw instanceof GitHubHttpError) {
    status = raw.status;
    headers = raw.headers;
    isRateLimit =
      raw.isRateLimit ?? isGitHubRateLimited(status, headers, raw.message);
    retryAfterMs = raw.retryAfterMs ?? parseGitHubRetryAfter(headers);
    message = raw.message;
  } else if (raw instanceof Response) {
    status = raw.status;
    headers = raw.headers;
    isRateLimit = isGitHubRateLimited(status, headers);
    retryAfterMs = parseGitHubRetryAfter(headers);
  } else if (
    raw &&
    typeof raw === "object" &&
    "status" in raw &&
    typeof (raw as { status: unknown }).status === "number"
  ) {
    const httpLike = raw as {
      status: number;
      headers?: unknown;
      message?: string;
      isRateLimit?: boolean;
      retryAfterMs?: number;
    };
    status = httpLike.status;
    if (httpLike.headers instanceof Headers) {
      headers = httpLike.headers;
    } else if (httpLike.headers && typeof httpLike.headers === "object") {
      for (const [k, v] of Object.entries(
        httpLike.headers as Record<string, string>,
      )) {
        if (typeof v === "string") headers.set(k, v);
      }
    }
    if (typeof httpLike.message === "string") {
      message = httpLike.message;
    }
    isRateLimit =
      httpLike.isRateLimit ?? isGitHubRateLimited(status, headers, message);
    retryAfterMs = httpLike.retryAfterMs ?? parseGitHubRetryAfter(headers);
  } else if (raw instanceof Error) {
    message = raw.message;
  } else if (typeof raw === "string") {
    message = raw;
  }

  // 1. Semantic Status Classification (Highest Precedence)
  if (status === 401) {
    return { code: "AUTH_INVALID", context };
  }

  if (status === 403) {
    if (isRateLimit) {
      return {
        code: "RATE_LIMITED",
        context,
        ...(typeof retryAfterMs === "number" && retryAfterMs > 0
          ? { retryAfterMs }
          : {}),
      };
    }
    // 403 without rate-limit headers: distinct permission error
    return { code: "PERMISSION", context };
  }

  if (status === 404) {
    return { code: "NOT_FOUND", context };
  }

  if (status === 429 || isRateLimit) {
    return {
      code: "RATE_LIMITED",
      context,
      ...(typeof retryAfterMs === "number" && retryAfterMs > 0
        ? { retryAfterMs }
        : {}),
    };
  }

  // 2. Message Heuristics Fallback
  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("rate limit") ||
    lowerMsg.includes("secondary rate limit") ||
    lowerMsg.includes("too many requests")
  ) {
    return {
      code: "RATE_LIMITED",
      context,
      ...(typeof retryAfterMs === "number" && retryAfterMs > 0
        ? { retryAfterMs }
        : {}),
    };
  }

  if (
    lowerMsg.includes("bad credentials") ||
    lowerMsg.includes("unauthorized") ||
    lowerMsg.includes("authentication failed") ||
    lowerMsg.includes("personal access token") ||
    lowerMsg.includes("token required")
  ) {
    return { code: "AUTH_INVALID", context };
  }

  if (
    lowerMsg.includes("forbidden") ||
    lowerMsg.includes("permission") ||
    lowerMsg.includes("scope")
  ) {
    return { code: "PERMISSION", context };
  }

  if (lowerMsg.includes("not found")) {
    return { code: "NOT_FOUND", context };
  }

  return { code: "UNKNOWN", context };
}

// ---------------------------------------------------------------------------
// Quick-URL Intake (parseQuickUrl)
// ---------------------------------------------------------------------------

export function parseGitHubQuickUrl(url: string): QuickUrlDraft | null {
  if (typeof url !== "string" || !url.trim()) {
    return null;
  }

  const trimmed = url.trim();

  // Validate hostname to reject malicious / spoofed domains
  try {
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const parsedUrl = new URL(trimmed);
      if (
        parsedUrl.hostname !== "github.com" &&
        parsedUrl.hostname !== "www.github.com"
      ) {
        return null;
      }
    } else if (trimmed.includes("://")) {
      return null;
    } else {
      const hostPart = trimmed.split("/")[0]?.split(":")[0];
      if (
        hostPart &&
        hostPart !== "github.com" &&
        hostPart !== "www.github.com" &&
        hostPart !== "git@github.com"
      ) {
        return null;
      }
    }
  } catch {
    return null;
  }

  const extracted = extractFromGitHubUrl(trimmed);
  if (!extracted?.owner) {
    return null;
  }

  const configDraft: ProviderConfig = {
    repoOwner: extracted.owner,
    ...(extracted.repo ? { repository: extracted.repo } : {}),
  };

  return {
    configDraft,
    inferredName: extracted.repo || extracted.owner,
  };
}

// ---------------------------------------------------------------------------
// Criteria Extraction
// ---------------------------------------------------------------------------

function isSectionHeader(line: string): boolean {
  return /^(?:#+\s*)?(?:acceptance\s+criteria|criteria|requirements)[:\s]*$/i.test(
    line,
  );
}

function sanitizeCriteriaLine(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .trim();
}

function parseBulletLine(line: string): string | null {
  const match = line.match(/^[-*+]\s+(?:\[[ xX]\]\s*)?(.+)$/);
  return match?.[1] ? sanitizeCriteriaLine(match[1]) : null;
}

export function extractCriteria(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const headerIdx = lines.findIndex(isSectionHeader);

  if (headerIdx >= 0) {
    const sectionLines: string[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const currentLine = lines[i];
      if (!currentLine) continue;
      if (/^#+\s+/.test(currentLine)) break;
      const bullet = parseBulletLine(currentLine);
      if (bullet) {
        sectionLines.push(bullet);
      } else if (currentLine.length > 5) {
        sectionLines.push(sanitizeCriteriaLine(currentLine));
      }
    }
    return sectionLines;
  }

  return lines.map(parseBulletLine).filter((b): b is string => Boolean(b));
}

// ---------------------------------------------------------------------------
// Provider Factory & Implementation
// ---------------------------------------------------------------------------

/**
 * Creates a GitHub Provider instance with optional injected dependencies.
 */
export function createGithubProvider(
  deps: GitHubProviderDependencies = {},
): Provider<"github"> {
  const getFetcher = () => deps.fetchFn || globalThis.fetch;
  const executor = deps.executor;

  return {
    id: "github",
    displayName: "GitHub",
    roles: ["tracker", "gitHost"] as const,
    iconRef: "provider-github",
    configSchema: githubConfigSchema,

    toUserError(raw: unknown, context: ProviderErrorContext): ProviderError {
      return toGitHubUserError(raw, context);
    },

    async verifyCredentials(
      config: ProviderConfig,
    ): Promise<VerificationResult> {
      // 1. Detect nested-config ambiguity (#129 P0 fix)
      const mismatch = detectGitHubConfigMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const { token, owner, repo } = resolveGitHubConfig(config);
      if (!token) {
        throw new GitHubHttpError("GitHub Personal Access Token is required.", {
          status: 401,
          headers: new Headers(),
        });
      }

      const headers = resolveGitHubHeaders(token);

      // 2. Primary credential verification via GET /user
      const userRes = await githubFetch("https://api.github.com/user", {
        headers,
        fetchFn: getFetcher(),
      });

      const warnings: VerificationWarning[] = [];

      // 3. Owner / Organization probe if owner configured
      if (owner) {
        try {
          await githubFetch(
            `https://api.github.com/orgs/${encodeURIComponent(owner)}`,
            { headers, fetchFn: getFetcher() },
          );
        } catch (orgErr) {
          if (orgErr instanceof GitHubHttpError && orgErr.status === 404) {
            try {
              await githubFetch(
                `https://api.github.com/users/${encodeURIComponent(owner)}`,
                { headers, fetchFn: getFetcher() },
              );
            } catch (userErr) {
              if (
                userErr instanceof GitHubHttpError &&
                userErr.status === 404
              ) {
                throw new GitHubHttpError(
                  `GitHub account or organization "${owner}" was not found.`,
                  { status: 404, headers: userErr.headers },
                );
              }
              warnings.push({
                kind: "CAPABILITY_UNCONFIRMED",
                capability: "listRepositories",
              });
            }
          } else if (
            orgErr instanceof GitHubHttpError &&
            orgErr.status === 403
          ) {
            warnings.push({
              kind: "CAPABILITY_UNCONFIRMED",
              capability: "listRepositories",
            });
          } else {
            throw orgErr;
          }
        }
      }

      // 4. Repo probe if repo configured
      if (owner && repo) {
        try {
          await githubFetch(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
            { headers, fetchFn: getFetcher() },
          );
        } catch (repoErr) {
          if (repoErr instanceof GitHubHttpError && repoErr.status === 404) {
            throw new GitHubHttpError(
              `GitHub repository "${owner}/${repo}" was not found.`,
              { status: 404, headers: repoErr.headers },
            );
          }
          warnings.push({
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "createPullRequest",
          });
        }
      }

      // 5. Header-introspection scope checking for classic PATs
      const oauthScopesHeader = userRes.headers.get("x-oauth-scopes");
      if (oauthScopesHeader !== null) {
        const scopes = oauthScopesHeader
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        const hasRepoScope = scopes.includes("repo");
        if (!hasRepoScope) {
          warnings.push({
            kind: "CAPABILITY_UNCONFIRMED",
            capability: "createPullRequest",
          });
        }
      } else {
        // Fine-grained PAT: scope headers not present; leave unconfirmed
        warnings.push({
          kind: "CAPABILITY_UNCONFIRMED",
          capability: "createPullRequest",
        });
      }

      if (warnings.length > 0) {
        return {
          status: "degraded",
          warnings,
        };
      }

      return {
        status: "ok",
        warnings: [],
      };
    },

    async verifyScopes(
      config: ProviderConfig,
    ): Promise<ScopeVerificationReport> {
      const mismatch = detectGitHubConfigMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const { token } = resolveGitHubConfig(config);
      if (!token) {
        throw new GitHubHttpError("GitHub Personal Access Token is required.", {
          status: 401,
          headers: new Headers(),
        });
      }

      const headers = resolveGitHubHeaders(token);
      const userRes = await githubFetch("https://api.github.com/user", {
        headers,
        fetchFn: getFetcher(),
      });

      const findings: ScopeFinding[] = [];
      let overPrivileged = false;

      const oauthScopes = userRes.headers.get("x-oauth-scopes");
      if (oauthScopes !== null) {
        const scopes = oauthScopes
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);

        const hasRepo = scopes.includes("repo");
        const hasPublicRepo = scopes.includes("public_repo");

        findings.push({
          capability: "listRepositories",
          status: hasRepo || hasPublicRepo ? "confirmed" : "missing",
        });
        findings.push({
          capability: "createPullRequest",
          status: hasRepo ? "confirmed" : "unconfirmed",
        });

        const adminScopes = [
          "admin:org",
          "delete_repo",
          "admin:repo_hook",
          "site_admin",
        ];
        if (scopes.some((s) => adminScopes.includes(s))) {
          overPrivileged = true;
        }
      } else {
        findings.push({
          capability: "listRepositories",
          status: "unconfirmed",
        });
        findings.push({
          capability: "createPullRequest",
          status: "unconfirmed",
        });
      }

      findings.push({ capability: "verifyScopes", status: "confirmed" });

      return {
        findings,
        overPrivileged,
      };
    },

    parseQuickUrl(url: string): QuickUrlDraft | null {
      return parseGitHubQuickUrl(url);
    },

    async listRepositories(
      config: ProviderConfig,
    ): Promise<ProviderRepository[]> {
      const mismatch = detectGitHubConfigMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const { token, owner } = resolveGitHubConfig(config);
      const headers = resolveGitHubHeaders(token);

      const initialUrl = owner
        ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?per_page=100&type=all`
        : "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";

      const allRepos: Array<Record<string, unknown>> = [];
      let currentUrl: string | null = initialUrl;

      while (currentUrl) {
        let res: { data: unknown; headers: Headers };
        try {
          res = await githubFetch(currentUrl, {
            headers,
            fetchFn: getFetcher(),
          });
        } catch (err) {
          if (
            err instanceof GitHubHttpError &&
            err.status === 404 &&
            owner &&
            currentUrl === initialUrl
          ) {
            // Fallback to /users/{username}/repos
            const userUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100`;
            res = await githubFetch(userUrl, {
              headers,
              fetchFn: getFetcher(),
            });
          } else {
            throw err;
          }
        }

        const items = Array.isArray(res.data) ? res.data : [];
        for (const item of items) {
          if (item && typeof item === "object") {
            allRepos.push(item as Record<string, unknown>);
          }
        }

        const linkHeader = res.headers.get("link");
        currentUrl = null;
        if (linkHeader) {
          const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
          if (match?.[1]) {
            currentUrl = match[1];
          }
        }
      }

      return allRepos.map((r) => ({
        id: String(r.id ?? ""),
        name: String(r.name ?? ""),
        remote: String(r.clone_url ?? r.html_url ?? ""),
        defaultBranch:
          typeof r.default_branch === "string" ? r.default_branch : "main",
        ...(typeof r.html_url === "string" ? { webUrl: r.html_url } : {}),
      }));
    },

    async listTickets(
      config: ProviderConfig,
      options: TicketQueryOptions,
    ): Promise<TrackerTicket[]> {
      const mismatch = detectGitHubConfigMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const { token, owner, repo } = resolveGitHubConfig(config);
      if (!owner || !repo) {
        throw new Error(
          `Listing tickets requires both owner and repository (received owner="${owner}", repo="${repo}").`,
        );
      }

      const label = options.requiredLabel || REQUIRED_WORKFLOW_LABEL;
      const headers = resolveGitHubHeaders(token);
      const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=50`;

      const res = await githubFetch(url, {
        headers,
        fetchFn: getFetcher(),
      });

      const issues = (Array.isArray(res.data) ? res.data : []) as Array<
        Record<string, unknown>
      >;

      return issues
        .filter((item) => !item.pull_request)
        .map((item) => {
          const rawLabels = Array.isArray(item.labels) ? item.labels : [];
          const labelNames = rawLabels
            .map((l: unknown) =>
              typeof l === "string"
                ? l
                : typeof l === "object" && l !== null && "name" in l
                  ? String((l as { name: string }).name)
                  : "",
            )
            .filter(Boolean);

          const title = String(item.title || "");
          const body = String(item.body || "");
          const number = String(item.number || "");
          const htmlUrl = String(item.html_url || "");
          const updatedAt =
            typeof item.updated_at === "string" ? item.updated_at : undefined;

          return {
            id: `GH-${number}`,
            title,
            description: body,
            acceptanceCriteria: extractCriteria(body),
            labels: labelNames,
            url: htmlUrl,
            provider: "github" as const,
            ...(updatedAt ? { updatedAt } : {}),
          };
        });
    },

    async createPullRequest(
      config: ProviderConfig,
      input: CreatePullRequestInput,
    ): Promise<ProviderPullRequest> {
      // Assert create-only safety invariant (#127 §7)
      if (PR_CREATE_ONLY !== "create-only") {
        throw new Error(
          "PR policy violation: only create operations are permitted.",
        );
      }

      const mismatch = detectGitHubConfigMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const {
        token,
        owner: configOwner,
        repo: configRepo,
      } = resolveGitHubConfig(config);
      const { owner, repo } = resolveRepoCoordinates(
        input.repository,
        configOwner,
      );
      const effectiveRepo = repo || configRepo;
      if (!owner || !effectiveRepo) {
        throw new Error(
          `Unable to determine owner/repo for pull request: owner="${owner}", repo="${effectiveRepo}".`,
        );
      }

      let restError: unknown;

      // 1. Primary: REST API
      if (token) {
        try {
          const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(effectiveRepo)}/pulls`;
          const res = await githubFetch(endpoint, {
            method: "POST",
            headers: {
              ...resolveGitHubHeaders(token),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              title: input.title,
              body: input.description,
              head: input.sourceBranch,
              base: input.targetBranch,
            }),
            fetchFn: getFetcher(),
          });

          const data = (
            res.data && typeof res.data === "object" ? res.data : {}
          ) as Record<string, unknown>;
          const head = (
            data.head && typeof data.head === "object" ? data.head : {}
          ) as Record<string, unknown>;
          const base = (
            data.base && typeof data.base === "object" ? data.base : {}
          ) as Record<string, unknown>;

          return {
            url: String(data.html_url || ""),
            status: typeof data.state === "string" ? data.state : "open",
            sourceBranch:
              typeof head.ref === "string" ? head.ref : input.sourceBranch,
            targetBranch:
              typeof base.ref === "string" ? base.ref : input.targetBranch,
            ...(head.sha ? { lastMergeSourceCommit: String(head.sha) } : {}),
          };
        } catch (err) {
          restError = err;
        }
      } else {
        restError = new GitHubHttpError(
          "No GitHub token configured for REST API.",
          {
            status: 401,
            headers: new Headers(),
          },
        );
      }

      // 2. Fallback: gh CLI executable (only when REST failed)
      if (executor) {
        try {
          const cliResult = await executor("gh", [
            "pr",
            "create",
            "--repo",
            `${owner}/${effectiveRepo}`,
            "--title",
            input.title,
            "--body",
            input.description,
            "--head",
            input.sourceBranch,
            "--base",
            input.targetBranch,
          ]);

          if (cliResult.passed && cliResult.stdout.trim()) {
            const firstLine = cliResult.stdout.trim().split("\n")[0]?.trim();
            if (firstLine) {
              return {
                url: firstLine,
                status: "open",
                sourceBranch: input.sourceBranch,
                targetBranch: input.targetBranch,
              };
            }
          }
        } catch {
          // CLI fallback failed; propagate primary REST error
        }
      }

      throw restError;
    },

    async findExistingPullRequest(
      config: ProviderConfig,
      input: FindPullRequestInput,
    ): Promise<ProviderPullRequest | null> {
      const mismatch = detectGitHubConfigMismatch(config);
      if (mismatch.mismatch) {
        throw new Error(mismatch.error);
      }

      const {
        token,
        owner: configOwner,
        repo: configRepo,
      } = resolveGitHubConfig(config);
      const { owner, repo } = resolveRepoCoordinates(
        input.repository,
        configOwner,
      );
      const effectiveRepo = repo || configRepo;
      if (!owner || !effectiveRepo) {
        return null;
      }

      let lookupError: unknown = null;
      if (token) {
        try {
          const endpoint = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(effectiveRepo)}/pulls?head=${encodeURIComponent(`${owner}:${input.sourceBranch}`)}&state=all`;
          const res = await githubFetch(endpoint, {
            headers: resolveGitHubHeaders(token),
            fetchFn: getFetcher(),
          });

          const pulls = (Array.isArray(res.data) ? res.data : []) as Array<
            Record<string, unknown>
          >;
          const match = pulls.find((p) => {
            const h = p.head as Record<string, unknown> | undefined;
            return h?.ref === input.sourceBranch;
          });

          if (match) {
            const head = (
              match.head && typeof match.head === "object" ? match.head : {}
            ) as Record<string, unknown>;
            const base = (
              match.base && typeof match.base === "object" ? match.base : {}
            ) as Record<string, unknown>;
            return {
              url: String(match.html_url || ""),
              status: typeof match.state === "string" ? match.state : "open",
              sourceBranch:
                typeof head.ref === "string" ? head.ref : input.sourceBranch,
              targetBranch: typeof base.ref === "string" ? base.ref : "main",
              ...(head.sha ? { lastMergeSourceCommit: String(head.sha) } : {}),
            };
          }
          return null;
        } catch (err) {
          lookupError = err;
        }
      }

      // Fallback: gh CLI
      if (executor) {
        try {
          const cliResult = await executor("gh", [
            "pr",
            "view",
            input.sourceBranch,
            "--repo",
            `${owner}/${effectiveRepo}`,
            "--json",
            "url,headRefName,headRefOid,baseRefName,state",
          ]);

          if (cliResult.passed && cliResult.stdout.trim()) {
            const data = JSON.parse(cliResult.stdout) as {
              url?: string;
              state?: string;
              headRefName?: string;
              headRefOid?: string;
              baseRefName?: string;
            };
            if (data?.url) {
              return {
                url: data.url,
                status: data.state || "open",
                sourceBranch: data.headRefName || input.sourceBranch,
                targetBranch: data.baseRefName || "main",
                ...(data.headRefOid
                  ? { lastMergeSourceCommit: data.headRefOid }
                  : {}),
              };
            }
          }

          if (
            !cliResult.passed &&
            cliResult.stderr &&
            cliResult.stderr.includes("no pull requests found")
          ) {
            return null;
          }
        } catch {
          // ignore CLI failure
        }
      }

      if (lookupError) {
        throw lookupError;
      }
      return null;
    },
  };
}

/** Production GitHub provider singleton */
export const githubProvider: Provider<"github"> = createGithubProvider();

/** CamelCase alias */
export const gitHubProvider = githubProvider;
