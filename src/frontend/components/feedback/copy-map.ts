// src/frontend/components/feedback/copy-map.ts — THE canonical copy map (#135).
//
// Decided in #135 (spec #133, resolution #129): this module is the ONLY place
// canonical feedback copy lives. It carries the (code, context) → message map
// for the normalized error envelope, the five-state guidance strings, and the
// retry/refresh/countdown labels. Feedback components must not declare copy
// inline; screens override copy only through props when a region needs
// bespoke guidance. Localization stays possible because every string lives
// here (spec #133 §Out of scope).
//
// Unknown error payloads NEVER render their raw message — anything that is
// not a normalized envelope gets `STATE_COPY.errorFallback` (spec #133:
// "never a raw provider body").

import type {
  FeedbackErrorCode,
  FeedbackErrorContext,
  NormalizedError,
} from "./types.js";

/**
 * The (code, context) → message map. Codes and contexts mirror the provider
 * contract's closed sets (#129); context names the failed operation so the
 * message can say what broke without provider-specific terminology.
 */
export const ERROR_COPY: Readonly<
  Record<FeedbackErrorCode, Readonly<Record<FeedbackErrorContext, string>>>
> = {
  AUTH_INVALID: {
    VERIFY: "The credentials were rejected. Check the token and try again.",
    DISCOVERY:
      "The credentials were rejected while discovering repositories. Check the token and try again.",
    TICKETS:
      "The credentials were rejected while loading tickets. Check the token and try again.",
    PR: "The credentials were rejected while creating the pull request. Check the token and try again.",
  },
  AUTH_LOCKED: {
    VERIFY:
      "Sign-in is temporarily locked by the provider. Wait a moment, then try again.",
    DISCOVERY:
      "Sign-in is temporarily locked, so repositories could not load. Wait a moment, then try again.",
    TICKETS:
      "Sign-in is temporarily locked, so tickets could not load. Wait a moment, then try again.",
    PR: "Sign-in is temporarily locked, so the pull request could not be created. Wait a moment, then try again.",
  },
  NOT_FOUND: {
    VERIFY:
      "The account or workspace is not visible to this token. Check the address and token.",
    DISCOVERY:
      "The organization, project, or workspace could not be found. Check the URL.",
    TICKETS:
      "The tickets source could not be found. Check the project and repository addresses.",
    PR: "The pull request target could not be found. Check the repository and branches.",
  },
  RATE_LIMITED: {
    VERIFY:
      "The provider is limiting requests, so the connection check failed. Wait a moment, then try again.",
    DISCOVERY:
      "The provider is limiting requests, so repositories could not load. Wait a moment, then try again.",
    TICKETS:
      "The provider is limiting requests, so tickets could not load. Wait a moment, then try again.",
    PR: "The provider is limiting requests, so the pull request could not be created. Wait a moment, then try again.",
  },
  PERMISSION: {
    VERIFY:
      "The token does not have the permissions required to verify this connection.",
    DISCOVERY:
      "The token does not have the permissions required to discover repositories.",
    TICKETS:
      "The token does not have the permissions required to load tickets.",
    PR: "The token does not have the permissions required to create the pull request.",
  },
  UNKNOWN: {
    VERIFY:
      "An unexpected error occurred while verifying the connection. Try again.",
    DISCOVERY:
      "An unexpected error occurred while discovering repositories. Try again.",
    TICKETS: "An unexpected error occurred while loading tickets. Try again.",
    PR: "An unexpected error occurred while creating the pull request. Try again.",
  },
};

/** Canonical copy for the five-state taxonomy and the uniform actions. */
export const STATE_COPY = {
  /** Loading: rendered beside the indeterminate spinner in its reserved region. */
  loading: "Loading…",
  /** Empty: guidance text, overridable per region via props. */
  empty: "Nothing here yet.",
  /** Partial: banner title naming that some results failed. */
  partial: "Some results could not load.",
  /** Stale: the visible out-of-date badge (#132). */
  stale: "Out of date",
  /** The uniform retry affordance label. */
  retry: "Try again",
  /** The stale-region refresh label. */
  refresh: "Refresh",
  /** Fallback for any error that is not a normalized envelope. */
  errorFallback: "The request failed. Try again.",
} as const;

/**
 * Runtime guard for values crossing the API boundary as error envelopes.
 * Mirrors the provider contract's `isProviderError` (#129): a positive
 * `retryAfterMs` or none at all.
 */
export function isNormalizedError(value: unknown): value is NormalizedError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<NormalizedError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.context === "string" &&
    candidate.code in ERROR_COPY &&
    candidate.context in ERROR_COPY[candidate.code as FeedbackErrorCode] &&
    (candidate.retryAfterMs === undefined ||
      (typeof candidate.retryAfterMs === "number" &&
        candidate.retryAfterMs > 0))
  );
}

/** Resolves canonical copy for a known (code, context) pair. */
export function getErrorCopy(
  code: FeedbackErrorCode,
  context: FeedbackErrorContext,
): string {
  return ERROR_COPY[code][context];
}

/**
 * Resolves canonical copy for any error payload. Normalized envelopes go
 * through the map; everything else gets the fallback — a raw provider body or
 * message is never rendered.
 */
export function resolveErrorCopy(error: unknown): string {
  return isNormalizedError(error)
    ? getErrorCopy(error.code, error.context)
    : STATE_COPY.errorFallback;
}

/**
 * Rate-limit timed guidance (#129): canonical countdown copy derived from the
 * envelope's `retryAfterMs`, in whole seconds. `FeedbackBanner` and
 * `AsyncRegion` tick the remaining window once per second via
 * `use-retry-countdown` so the retry un-disables itself.
 */
export function formatRetryCountdown(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return `Retry available in ${seconds}s`;
}
