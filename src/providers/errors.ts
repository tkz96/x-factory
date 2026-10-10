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
  getProviderErrorCopy,
  PROVIDER_ERROR_COPY,
} from "../shared/provider-error-copy.js";
import {
  isProviderError,
  type ProviderErrorCode,
  type ProviderErrorContext,
  type ProviderErrorEnvelope,
} from "./contract.js";

/**
 * The canonical (code, context) -> message map for provider errors, re-exported
 * from the shared copy table so the provider layer and the frontend copy map
 * share one definition (#184). Context names the failed operation so the
 * message explains what broke without leaking raw provider bodies, headers, or
 * internal trace text.
 */
export const PROVIDER_ERROR_MESSAGES: Readonly<
  Record<ProviderErrorCode, Readonly<Record<ProviderErrorContext, string>>>
> = PROVIDER_ERROR_COPY;

/** Resolves canonical copy for a (code, context) pair. */
export function getProviderErrorMessage(
  code: ProviderErrorCode,
  context: ProviderErrorContext,
): string {
  return getProviderErrorCopy(code, context);
}

export interface ProviderErrorOptions {
  retryAfterMs?: number | undefined;
  cause?: unknown;
}

/**
 * Normalized provider error thrown by provider capability calls.
 * Carries the contract code, context, optional retryAfterMs, and the canonical message.
 * The raw provider failure is kept only as `cause`, for the code that handles
 * the error; it is never part of the message and must never be logged.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly context: ProviderErrorContext;
  readonly retryAfterMs?: number | undefined;

  constructor(
    code: ProviderErrorCode,
    context: ProviderErrorContext,
    options?: ProviderErrorOptions,
  ) {
    const cause = options?.cause;
    super(
      getProviderErrorMessage(code, context),
      cause !== undefined ? { cause } : undefined,
    );
    this.name = "ProviderError";
    this.code = code;
    this.context = context;
    const retry = options?.retryAfterMs;
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
