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

/** Default per-request timeout applied by adapters; the HTTP module owns timeouts. */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 30_000;

const LOGIN_HOST = /^(?:login|signin|sso)\./i;
const LOGIN_PATH = /^\/(?:login|signin|sign-in)(?:[/?#]|$)/i;

/**
 * True when a redirect target points at a sign-in page: a login host such as
 * login.microsoftonline.com, or a path that starts with /login or /signin.
 * Names that merely contain "login" (for example /repos/acme/login-service)
 * do not match.
 */
export function isLoginTarget(target: string, base?: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(target, base ?? "https://placeholder.invalid");
  } catch {
    return false;
  }
  return LOGIN_HOST.test(parsed.hostname) || LOGIN_PATH.test(parsed.pathname);
}

/**
 * True when the response was redirected (3xx or followed by fetch) to a sign-in page.
 */
export function isLoginRedirect(res: {
  status: number;
  redirected?: boolean;
  url?: string;
  headers?: Headers;
}): boolean {
  const base = res.url || undefined;
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers?.get("location");
    if (location && isLoginTarget(location, base)) return true;
  }
  return Boolean(res.redirected && res.url && isLoginTarget(res.url));
}

/**
 * Built-in sign-in check: 203, a redirect to a sign-in page, or a 2xx HTML
 * page that asks the user to sign in. A 4xx/5xx HTML page is never a sign-in,
 * because auth classification uses the status code.
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
  if (res.status === 203) return true;
  if (isLoginRedirect(res)) return true;

  if (res.status >= 200 && res.status < 300) {
    const contentType = res.headers?.get("content-type") || "";
    if (isHtmlResponse(contentType, bodyText)) {
      return /sign ?in|log ?in/i.test(bodyText || "");
    }
  }

  return false;
}

/**
 * Message from a parsed error body: its JSON `message`, else the body text
 * (first 300 chars), else the fallback.
 */
export function extractErrorMessage(data: unknown, fallback: string): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  if (typeof data === "string" && data.trim()) {
    return data.trim().slice(0, 300);
  }
  return fallback;
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
  fetchFn?: HttpTransport | undefined;
  timeoutMs?: number | undefined;
  /** Hook for adapter-specific rate-limit evidence. */
  isRateLimited?: (
    status: number,
    headers: Headers,
    bodyText: string,
    data: unknown,
  ) => boolean;
  /** Adapter hook for sign-in detection; replaces the built-in check. */
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
  const fetcher = options.fetchFn || globalThis.fetch;
  const urlStr = typeof url === "string" ? url : url.toString();
  const createError = options.errorFactory ?? defaultErrorFactory;
  const callerSignal = options.signal ?? undefined;

  const failTransport = (err: unknown, isTimeout: boolean): never => {
    throw createError(
      err instanceof Error ? err.message : "Network request failed",
      { status: 0, headers: new Headers(), isTimeout, cause: err },
    );
  };

  if (callerSignal?.aborted) {
    failTransport(callerSignal.reason, false);
  }

  // Our own timer aborts a controller chained to the caller's signal.
  let signal = callerSignal;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let onCallerAbort: (() => void) | undefined;
  let timedOut = false;

  if (typeof options.timeoutMs === "number" && options.timeoutMs > 0) {
    const controller = new AbortController();
    if (callerSignal) {
      onCallerAbort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
    timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort(
        new DOMException("The request timed out.", "TimeoutError"),
      );
    }, options.timeoutMs);
    signal = controller.signal;
  }

  let res: Response;
  try {
    const {
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
    return failTransport(err, timedOut);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (callerSignal && onCallerAbort) {
      callerSignal.removeEventListener("abort", onCallerAbort);
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
  const isSignIn = (options.isSignInRedirect ?? isSignInRedirect)(
    res,
    bodyText,
  );

  if (isSignIn) {
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
    const fallback = `HTTP ${res.status} error`;
    const isRate =
      res.status === 429 ||
      (options.isRateLimited?.(res.status, res.headers, bodyText, parsed) ??
        false);

    throw createError(
      isHtml ? fallback : extractErrorMessage(parsed, fallback),
      {
        status: res.status,
        headers: res.headers,
        bodyText,
        data: parsed,
        retryAfterMs: parseRetryAfter(res.headers),
        isRateLimit: isRate,
        isHtml,
      },
    );
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
