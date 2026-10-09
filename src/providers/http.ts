// src/providers/http.ts — Provider HTTP module behind all three adapters (#173).

/**
 * Standard HTTP transport signature accepted by provider adapters.
 */
export type HttpTransport = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ProviderHttpErrorOptions {
  status: number;
  headers?: Headers | undefined;
  bodyText?: string | undefined;
  data?: unknown | undefined;
  retryAfterMs?: number | undefined;
  isRateLimit?: boolean | undefined;
  isHtml?: boolean | undefined;
  isTimeout?: boolean | undefined;
  cause?: unknown;
}

/**
 * Typed failure thrown by provider HTTP requests.
 */
export class ProviderHttpError extends Error {
  readonly status: number;
  readonly headers: Headers;
  readonly bodyText?: string | undefined;
  readonly data?: unknown | undefined;
  readonly retryAfterMs?: number | undefined;
  readonly isRateLimit?: boolean | undefined;
  readonly isHtml?: boolean | undefined;
  readonly isTimeout?: boolean | undefined;

  constructor(message: string, options: ProviderHttpErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ProviderHttpError";
    this.status = options.status;
    this.headers = options.headers ?? new Headers();
    this.bodyText = options.bodyText;
    this.data = options.data;
    this.retryAfterMs = options.retryAfterMs;
    this.isRateLimit = options.isRateLimit ?? options.status === 429;
    this.isHtml = options.isHtml ?? false;
    this.isTimeout = options.isTimeout ?? false;
  }
}

/**
 * Single canonical Retry-After parser across all providers.
 * Handles integer/decimal seconds and RFC 7231 HTTP dates.
 * Returns positive delay in milliseconds, or undefined if absent/non-positive/past.
 */
export function parseRetryAfter(
  headerOrHeaders?: Headers | string | null | undefined,
): number | undefined {
  if (!headerOrHeaders) return undefined;

  const headerValue =
    typeof headerOrHeaders === "string"
      ? headerOrHeaders
      : headerOrHeaders.get("retry-after");

  if (!headerValue) return undefined;

  const trimmed = headerValue.trim();
  if (!trimmed) return undefined;

  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }

  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const diff = dateMs - Date.now();
    return diff > 0 ? diff : undefined;
  }

  return undefined;
}

/**
 * Inspects Content-Type and body text for HTML document structures.
 */
export function isHtmlResponse(
  contentType?: string | null,
  bodyText?: string | null,
): boolean {
  if (
    contentType &&
    /\b(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType)
  ) {
    return true;
  }

  if (bodyText) {
    const trimmed = bodyText.trim();
    if (
      trimmed.startsWith("<!doctype html") ||
      trimmed.startsWith("<html") ||
      trimmed.startsWith("<head") ||
      trimmed.startsWith("<body") ||
      /<(?:!doctype\s+html|html|head|body)[^>]*>/i.test(trimmed)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Determines whether a response represents an authentication/sign-in redirect.
 */
export function isSignInRedirect(
  res: {
    status: number;
    redirected?: boolean;
    url?: string;
    headers?: Headers;
  },
  bodyText?: string | null,
): boolean {
  if (res.status === 203) {
    return true;
  }

  if (res.redirected && res.url) {
    const lowerUrl = res.url.toLowerCase();
    if (
      lowerUrl.includes("login.microsoftonline.com") ||
      lowerUrl.includes("signin") ||
      lowerUrl.includes("login")
    ) {
      return true;
    }
  }

  const location = res.headers?.get("location");
  if (location) {
    const lowerLoc = location.toLowerCase();
    if (
      lowerLoc.includes("login.microsoftonline.com") ||
      lowerLoc.includes("signin") ||
      lowerLoc.includes("login")
    ) {
      return true;
    }
  }

  const contentType = res.headers?.get("content-type") || "";
  if (isHtmlResponse(contentType, bodyText)) {
    const lowerBody = (bodyText || "").toLowerCase();
    if (
      lowerBody.includes("sign in") ||
      lowerBody.includes("signin") ||
      lowerBody.includes("log in") ||
      lowerBody.includes("login")
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Extracts the `rel="next"` URL from a standard HTTP Link header.
 */
export function parseLinkNextUrl(linkHeader?: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const section = part.split(";");
    if (section.length >= 2) {
      const hasRelNext = section
        .slice(1)
        .some((param) =>
          param.trim().replace(/\s+/g, "").includes('rel="next"'),
        );
      if (hasRelNext) {
        const urlMatch = section[0]?.trim().match(/<([^>]+)>/);
        if (urlMatch?.[1]) {
          return urlMatch[1];
        }
      }
    }
  }
  return null;
}

export interface ProviderFetchOptions
  extends Omit<RequestInit, "headers" | "body"> {
  headers?: HeadersInit | undefined;
  body?: BodyInit | null | undefined;
  transport?: HttpTransport | undefined;
  fetchFn?: HttpTransport | undefined;
  timeoutMs?: number | undefined;
  /** Hook for adapter-specific rate-limit evidence. */
  isRateLimited?: (
    status: number,
    headers: Headers,
    bodyText: string,
    data: unknown,
  ) => boolean;
  /** Hook for adapter-specific sign-in redirect detection. */
  isSignInRedirect?: (res: Response, bodyText: string) => boolean;
  /** Hook for constructing adapter-specific error classes. */
  errorFactory?: (
    message: string,
    options: ProviderHttpErrorOptions,
  ) => ProviderHttpError;
}

export interface ProviderFetchResponse<T = unknown> {
  status: number;
  headers: Headers;
  text: string;
  data: T;
  redirected: boolean;
  url: string;
}

function defaultErrorFactory(
  message: string,
  options: ProviderHttpErrorOptions,
): ProviderHttpError {
  return new ProviderHttpError(message, options);
}

/**
 * Central HTTP fetch pipeline for all provider adapters.
 */
export async function providerFetch<T = unknown>(
  url: string | URL,
  options: ProviderFetchOptions = {},
): Promise<ProviderFetchResponse<T>> {
  const fetcher = options.transport || options.fetchFn || globalThis.fetch;
  const urlStr = typeof url === "string" ? url : url.toString();

  // Manage timeouts
  let signal = options.signal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
    const controller = new AbortController();
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(signal?.reason));
    }
    timeoutId = setTimeout(() => {
      controller.abort(
        new DOMException("The request timed out.", "TimeoutError"),
      );
    }, options.timeoutMs);
    signal = controller.signal;
  }

  let res: Response;
  try {
    const {
      transport: _transport,
      fetchFn: _fetchFn,
      timeoutMs: _timeoutMs,
      isRateLimited: _isRateLimited,
      isSignInRedirect: _isSignInRedirect,
      errorFactory: _errorFactory,
      headers,
      body,
      signal: _origSignal,
      ...restOptions
    } = options;

    const requestInit: RequestInit = {
      ...restOptions,
      ...(signal ? { signal } : {}),
    };
    if (headers !== undefined) {
      requestInit.headers = headers;
    }
    if (body !== undefined) {
      requestInit.body = body;
    }

    res = await fetcher(urlStr, requestInit);
  } catch (err) {
    const isTimeout =
      (err instanceof DOMException &&
        (err.name === "TimeoutError" || err.name === "AbortError")) ||
      (err instanceof Error && /timeout|aborted/i.test(err.message));

    const message =
      err instanceof Error ? err.message : "Network request failed";
    const createError = options.errorFactory ?? defaultErrorFactory;

    throw createError(message, {
      status: 0,
      headers: new Headers(),
      isTimeout,
      cause: err,
    });
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }

  const contentType = res.headers.get("content-type") || "";
  const bodyText = await res.text();

  let parsed: unknown = null;
  if (bodyText.trim()) {
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      parsed = bodyText;
    }
  }

  const isHtml = isHtmlResponse(contentType, bodyText);
  const isSignIn =
    (options.isSignInRedirect
      ? options.isSignInRedirect(res, bodyText)
      : isSignInRedirect(res, bodyText)) ||
    res.status === 203 ||
    (isHtml && (res.status === 200 || res.status === 203));

  if (isSignIn) {
    const createError = options.errorFactory ?? defaultErrorFactory;

    throw createError(
      "Authentication sign-in challenge or HTML redirect received",
      {
        status: res.status,
        headers: res.headers,
        bodyText,
        data: parsed,
        isHtml: true,
      },
    );
  }

  if (!res.ok) {
    const retryAfterMs = parseRetryAfter(res.headers);
    const isRate =
      res.status === 429 ||
      (options.isRateLimited?.(res.status, res.headers, bodyText, parsed) ??
        false);

    let message = `HTTP ${res.status} error`;
    if (
      parsed &&
      typeof parsed === "object" &&
      "message" in parsed &&
      typeof (parsed as { message: unknown }).message === "string"
    ) {
      message = (parsed as { message: string }).message;
    } else if (typeof parsed === "string" && parsed.trim()) {
      message = parsed.slice(0, 300);
    }

    const createError = options.errorFactory ?? defaultErrorFactory;

    throw createError(message, {
      status: res.status,
      headers: res.headers,
      bodyText,
      data: parsed,
      retryAfterMs,
      isRateLimit: isRate,
    });
  }

  return {
    status: res.status,
    headers: res.headers,
    text: bodyText,
    data: parsed as T,
    redirected: res.redirected,
    url: res.url,
  };
}
