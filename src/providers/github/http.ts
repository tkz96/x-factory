// src/providers/github/http.ts — GitHub HTTP transport and response handling (#138).

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
  fetchFn?: typeof fetch | undefined;
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
  const customFetch = options.fetchFn || fetch;
  const requestInit: RequestInit = {
    method: options.method || "GET",
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.body ? { body: options.body } : {}),
  };

  let res: Response;
  try {
    res = await customFetch(url, requestInit);
  } catch (networkErr) {
    const message =
      networkErr instanceof Error
        ? networkErr.message
        : "Network request to GitHub failed";
    throw new GitHubHttpError(message, {
      status: 0,
      headers: new Headers(),
    });
  }

  const text = await res.text();
  let parsed: unknown = null;
  if (text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const isRateLimit = isGitHubRateLimited(res.status, res.headers, text);
    const retryAfterMs = parseGitHubRetryAfter(res.headers);
    let errorMessage = `GitHub API request failed with HTTP ${res.status}`;
    if (
      parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
    ) {
      errorMessage = (parsed as { message: string }).message;
    } else if (typeof parsed === "string" && parsed.trim()) {
      errorMessage = parsed.trim();
    }

    throw new GitHubHttpError(errorMessage, {
      status: res.status,
      headers: res.headers,
      bodyText: text,
      retryAfterMs,
      isRateLimit,
    });
  }

  return {
    status: res.status,
    headers: res.headers,
    data: parsed,
  };
}
