import {
  type HttpTransport,
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
  fetchFn?: typeof fetch | HttpTransport | undefined;
  transport?: HttpTransport | undefined;
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
    transport: options.transport || options.fetchFn,
    isRateLimited: (status, headers, text) =>
      isGitHubRateLimited(status, headers, text),
    errorFactory: (msg, opts) => {
      let errorMessage = `GitHub API request failed with HTTP ${opts.status}`;
      if (
        opts.data &&
        typeof opts.data === "object" &&
        "message" in opts.data &&
        typeof (opts.data as { message: unknown }).message === "string"
      ) {
        errorMessage = (opts.data as { message: string }).message;
      } else if (typeof opts.data === "string" && opts.data.trim()) {
        errorMessage = opts.data.trim();
      } else if (msg && opts.status === 0) {
        errorMessage = msg;
      }

      return new GitHubHttpError(errorMessage, {
        status: opts.status,
        headers: opts.headers,
        bodyText: opts.bodyText,
        retryAfterMs: opts.retryAfterMs ?? parseGitHubRetryAfter(opts.headers),
        isRateLimit: opts.isRateLimit,
      });
    },
  };
  if (options.method !== undefined) {
    fetchOpts.method = options.method;
  }
  if (options.body !== undefined) {
    fetchOpts.body = options.body;
  }
  const res = await providerFetch(url, fetchOpts);

  return {
    status: res.status,
    headers: res.headers,
    data: res.data,
  };
}
