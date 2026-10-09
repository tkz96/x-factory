// src/providers/errors.ts — Canonical provider error normalization, guard, and ProviderError class (#184).
//
// Decided in architecture review #163 and issue #184:
// - Error normalization: one status-to-ProviderError table with per-provider overrides.
// - The guard against passing a raw object through (which returns UNKNOWN) is written once,
//   fixing Azure's pass-through.
// - Canonical error messages mirror the feedback copy map; free-form raw provider text
//   never crosses the boundary.
// - Capability calls throw ProviderError tagged with its operation context.

import {
  isProviderError,
  type ProviderErrorCode,
  type ProviderErrorContext,
  type ProviderError as ProviderErrorEnvelope,
} from "./contract.js";

/**
 * The canonical (code, context) -> message map for provider errors.
 * Context names the failed operation so the message explains what broke
 * without leaking raw provider bodies, headers, or internal trace text.
 */
export const PROVIDER_ERROR_MESSAGES: Readonly<
  Record<ProviderErrorCode, Readonly<Record<ProviderErrorContext, string>>>
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

/** Resolves canonical copy for a known (code, context) pair. */
export function getProviderErrorMessage(
  code: ProviderErrorCode,
  context: ProviderErrorContext,
): string {
  const byCode = PROVIDER_ERROR_MESSAGES[code];
  if (byCode) {
    const msg = byCode[context];
    if (msg) return msg;
  }
  return PROVIDER_ERROR_MESSAGES.UNKNOWN[context];
}

export interface ProviderErrorOptions {
  retryAfterMs?: number | undefined;
  cause?: unknown;
}

/**
 * Normalized provider error thrown by provider capability calls.
 * Carries the contract code, context, optional retryAfterMs, and the canonical message.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly context: ProviderErrorContext;
  readonly retryAfterMs?: number | undefined;

  constructor(
    code: ProviderErrorCode,
    context: ProviderErrorContext,
    options?: ProviderErrorOptions | number,
  ) {
    const retry = typeof options === "number" ? options : options?.retryAfterMs;
    const cause = typeof options === "object" ? options?.cause : undefined;
    const message = getProviderErrorMessage(code, context);
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "ProviderError";
    this.code = code;
    this.context = context;
    if (retry !== undefined && retry > 0) {
      this.retryAfterMs = retry;
    }
  }
}

/**
 * Raw-object guard, written once (#184).
 *
 * If `raw` is a genuine ProviderError instance or valid ProviderError envelope
 * (matching `isProviderError` strictly without extra fields), its code and
 * retry delay are preserved with the target context.
 *
 * If `raw` is an object with `code` and `context` that fails the strict guard
 * (e.g. contains extra fields, invalid codes, or leaked internal state), it
 * normalizes to UNKNOWN, preventing raw object pass-through.
 *
 * Returns `null` if `raw` is not a code+context object, allowing status and
 * error mapping to proceed.
 */
export function normalizeRawObjectGuard(
  raw: unknown,
  context: ProviderErrorContext,
): ProviderErrorEnvelope | null {
  if (raw instanceof ProviderError) {
    return {
      code: raw.code,
      context,
      ...(raw.retryAfterMs !== undefined && raw.retryAfterMs > 0
        ? { retryAfterMs: raw.retryAfterMs }
        : {}),
    };
  }

  if (
    raw !== null &&
    typeof raw === "object" &&
    "code" in raw &&
    "context" in raw
  ) {
    if (isProviderError(raw)) {
      return {
        code: raw.code,
        context,
        ...(raw.retryAfterMs !== undefined && raw.retryAfterMs > 0
          ? { retryAfterMs: raw.retryAfterMs }
          : {}),
      };
    }
    // Object with code and context plus extra fields or invalid shape:
    // closes the raw-object pass-through by returning UNKNOWN.
    return { code: "UNKNOWN", context };
  }

  return null;
}
