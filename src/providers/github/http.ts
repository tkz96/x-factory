import {
  DEFAULT_PROVIDER_TIMEOUT_MS,
  extractErrorMessage,
  type HttpTransport,
  isLoginRedirect,
  type ProviderFetchOptions,
  providerFetch,
} from "../http.js";
import {
  GitHubHttpError,
  isGitHubRateLimited,
  parseGitHubRetryAfter,
} from "./errors.js";

/** Default GitHub API root URL. */
export const DEFAULT_GITHUB_API_ROOT = "https://api.github.com";

/**
 * Builds canonical GitHub HTTP headers for API communication.
 */
export function resolveGitHubHeaders(token?: string | undefined): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  headers.set("User-Agent", "x-factory");

  if (token?.trim()) {
    const trimmed = token.trim();
    if (trimmed.startsWith("Bearer ") || trimmed.startsWith("token ")) {
      headers.set("Authorization", trimmed);
    } else {
      headers.set("Authorization", `Bearer ${trimmed}`);
    }
  }

  return headers;
}

export interface GitHubFetchOptions {
  headers?: Headers | undefined;
  method?: string | undefined;
  body?: string | undefined;
  fetchFn?: HttpTransport | undefined;
  timeoutMs?: number | undefined;
  /** Caller's cancellation; aborts the in-flight request. */
  signal?: AbortSignal | undefined;
}

export interface GitHubFetchResponse {
  status: number;
  headers: Headers;
  data: unknown;
}

/**
 * Executes an HTTP request against GitHub API with error interpretation.
 */
export async function githubFetch(
  url: string,
  options: GitHubFetchOptions = {},
): Promise<GitHubFetchResponse> {
  const fetchOpts: ProviderFetchOptions = {
    headers: options.headers,
    fetchFn: options.fetchFn,
    timeoutMs: options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS,
    // GitHub's API has no sign-in flow: only a 203 or a redirect to a login page counts.
    isSignInRedirect: (res) => res.status === 203 || isLoginRedirect(res),
    isRateLimited: (status, headers, text) =>
      isGitHubRateLimited(status, headers, text),
    errorFactory: (msg, opts) => {
      const fallback = `GitHub API request failed with HTTP ${opts.status}`;
      const isChallenge =
        opts.isHtml && opts.status >= 200 && opts.status < 300;
      let message: string;
      if (opts.status === 0 || isChallenge) {
        message = msg;
      } else if (opts.isHtml) {
        message = fallback;
      } else {
        message = extractErrorMessage(opts.data, fallback);
      }

      return new GitHubHttpError(message, {
        status: opts.status,
        headers: opts.headers,
        bodyText: opts.bodyText,
        retryAfterMs: opts.retryAfterMs ?? parseGitHubRetryAfter(opts.headers),
        isRateLimit: opts.isRateLimit,
        data: opts.data,
        isHtml: opts.isHtml,
        isTimeout: opts.isTimeout,
        cause: opts.cause,
      });
    },
  };
  if (options.method !== undefined) {
    fetchOpts.method = options.method;
  }
  if (options.body !== undefined) {
    fetchOpts.body = options.body;
  }
  if (options.signal !== undefined) {
    fetchOpts.signal = options.signal;
  }
  const res = await providerFetch(url, fetchOpts);

  return {
    status: res.status,
    headers: res.headers,
    data: res.data,
  };
}
