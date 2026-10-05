// src/providers/github/errors.ts — GitHub error normalization and HTTP error class (#138).

import type {
  ProviderError,
  ProviderErrorCode,
  ProviderErrorContext,
} from "../contract.js";

/**
 * HTTP error thrown by GitHub API requests.
 */
export class GitHubHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText?: string | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly isRateLimit?: boolean | undefined;

  constructor(
    message: string,
    options: {
      status: number;
      headers?: Headers | undefined;
      bodyText?: string | undefined;
      retryAfterMs?: number | undefined;
      isRateLimit?: boolean | undefined;
    },
  ) {
    super(message);
    this.name = "GitHubHttpError";
    this.status = options.status;
    this.headers = options.headers ?? new Headers();
    this.bodyText = options.bodyText;
    this.retryAfterMs =
      options.retryAfterMs ?? parseGitHubRetryAfter(this.headers);
    this.isRateLimit =
      options.isRateLimit ??
      isGitHubRateLimited(this.status, this.headers, this.bodyText);
  }
}

/**
 * Extracts and parses rate-limit / retry delay in milliseconds from GitHub headers.
 * Inspects `retry-after` (seconds or HTTP date) and `x-ratelimit-reset` (epoch timestamp in seconds).
 */
export function parseGitHubRetryAfter(
  headers?: Headers | undefined,
): number | undefined {
  if (!headers) return undefined;

  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number.parseInt(retryAfter, 10);
    if (!Number.isNaN(seconds) && seconds > 0) {
      return seconds * 1000;
    }
    const dateMs = Date.parse(retryAfter);
    if (!Number.isNaN(dateMs)) {
      const diff = dateMs - Date.now();
      if (diff > 0) return diff;
    }
  }

  const resetHeader = headers.get("x-ratelimit-reset");
  if (resetHeader) {
    const resetEpochSec = Number.parseInt(resetHeader, 10);
    if (!Number.isNaN(resetEpochSec) && resetEpochSec > 0) {
      const resetMs = resetEpochSec * 1000;
      const diff = resetMs - Date.now();
      return diff > 0 ? diff : undefined;
    }
  }

  return undefined;
}

/**
 * Determines whether a GitHub response indicates rate-limiting.
 * Only rate-limit-plausible statuses (403, 429) can map to RATE_LIMITED.
 * A 401 with retry-after is strictly an auth error.
 */
export function isGitHubRateLimited(
  status: number,
  headers?: Headers | undefined,
  bodyText?: string | undefined,
): boolean {
  if (status === 429) return true;

  if (status === 403) {
    if (headers?.has("retry-after")) return true;
    const remaining = headers?.get("x-ratelimit-remaining");
    if (remaining === "0") return true;

    if (bodyText) {
      const lower = bodyText.toLowerCase();
      if (
        lower.includes("rate limit") ||
        lower.includes("secondary rate limit") ||
        lower.includes("api rate limit exceeded")
      ) {
        return true;
      }
    }
  }

  return false;
}

function resolveCodeFromStatus(
  status: number,
  headers: Headers | undefined,
  bodyText: string | undefined,
): ProviderErrorCode {
  if (isGitHubRateLimited(status, headers, bodyText)) {
    return "RATE_LIMITED";
  }
  if (status === 401) {
    return "AUTH_INVALID";
  }
  if (status === 403) {
    return "PERMISSION";
  }
  if (status === 404) {
    return "NOT_FOUND";
  }
  return "UNKNOWN";
}

function resolveCodeFromMessage(message: string): ProviderErrorCode {
  const lower = message.toLowerCase();
  if (
    lower.includes("rate limit") ||
    lower.includes("secondary rate limit") ||
    lower.includes("too many requests")
  ) {
    return "RATE_LIMITED";
  }
  if (
    lower.includes("bad credentials") ||
    lower.includes("unauthorized") ||
    lower.includes("invalid token") ||
    lower.includes("requires authentication") ||
    lower.includes("401")
  ) {
    return "AUTH_INVALID";
  }
  if (
    lower.includes("not found") ||
    lower.includes("404") ||
    lower.includes("could not resolve")
  ) {
    return "NOT_FOUND";
  }
  if (
    lower.includes("permission") ||
    lower.includes("forbidden") ||
    lower.includes("scope") ||
    lower.includes("access denied") ||
    lower.includes("403")
  ) {
    return "PERMISSION";
  }
  return "UNKNOWN";
}

/**
 * Normalizes an error into the canonical ProviderError shape.
 */
function extractExistingProviderError(
  error: unknown,
  context: ProviderErrorContext,
): ProviderError | null {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "context" in error
  ) {
    const existing = error as ProviderError;
    return {
      code: existing.code,
      context,
      ...(existing.retryAfterMs !== undefined
        ? { retryAfterMs: existing.retryAfterMs }
        : {}),
    };
  }
  return null;
}

function extractFromGitHubHttpError(
  error: GitHubHttpError,
  context: ProviderErrorContext,
): ProviderError {
  const code = error.isRateLimit
    ? "RATE_LIMITED"
    : resolveCodeFromStatus(error.status, error.headers, error.bodyText);
  const retryAfterMs = code === "RATE_LIMITED" ? error.retryAfterMs : undefined;
  return {
    code,
    context,
    ...(retryAfterMs !== undefined && retryAfterMs > 0 ? { retryAfterMs } : {}),
  };
}

function extractFromStatusLikeObject(
  error: Record<string, unknown>,
  context: ProviderErrorContext,
): ProviderError {
  const status = typeof error.status === "number" ? error.status : 0;
  const headers = error.headers instanceof Headers ? error.headers : undefined;
  const bodyText =
    typeof error.message === "string" ? error.message : undefined;

  const code = resolveCodeFromStatus(status, headers, bodyText);
  const retryAfterMs =
    typeof error.retryAfterMs === "number" && error.retryAfterMs > 0
      ? error.retryAfterMs
      : parseGitHubRetryAfter(headers);

  return {
    code,
    context,
    ...(code === "RATE_LIMITED" &&
    typeof retryAfterMs === "number" &&
    retryAfterMs > 0
      ? { retryAfterMs }
      : {}),
  };
}

function extractFromStandardError(
  error: Error,
  context: ProviderErrorContext,
): ProviderError {
  const code = resolveCodeFromMessage(error.message);
  const retryAfterMs =
    code === "RATE_LIMITED" && "retryAfterMs" in error
      ? Number(error.retryAfterMs)
      : undefined;

  return {
    code,
    context,
    ...(retryAfterMs !== undefined && retryAfterMs > 0 ? { retryAfterMs } : {}),
  };
}

/**
 * Normalizes an error into the canonical ProviderError shape.
 */
export function toGitHubUserError(
  error: unknown,
  context: ProviderErrorContext,
): ProviderError {
  const existing = extractExistingProviderError(error, context);
  if (existing) return existing;

  if (error instanceof GitHubHttpError) {
    return extractFromGitHubHttpError(error, context);
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    return extractFromStatusLikeObject(
      error as Record<string, unknown>,
      context,
    );
  }

  if (error instanceof Error) {
    return extractFromStandardError(error, context);
  }

  return {
    code: "UNKNOWN",
    context,
  };
}
