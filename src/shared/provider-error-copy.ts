// src/shared/provider-error-copy.ts — THE canonical provider error copy table (#184).
//
// One definition for the two sides of the API boundary: the provider layer
// (src/providers/errors.ts) and the frontend copy map
// (src/frontend/components/feedback/copy-map.ts). The frontend must never
// import src/providers, and the two tables had to stay byte-identical, so the
// table lives in the shared layer and each side re-exports it.
//
// The raw provider failure never becomes copy: the message names the failed
// operation without leaking provider bodies, headers, or internal trace text.

/**
 * The closed provider error-code set (#129). Mirrors `ProviderErrorCode` in
 * `src/providers/contract.ts` and `FeedbackErrorCode` in
 * `src/frontend/components/feedback/types.ts`. The shared layer imports
 * neither, so it declares the set it types the table with.
 */
type ProviderErrorCopyCode =
  | "AUTH_INVALID"
  | "AUTH_LOCKED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "PERMISSION"
  | "UNKNOWN";

/** The failed operation. Required — there is no fallback context (#129). */
type ProviderErrorCopyContext = "VERIFY" | "DISCOVERY" | "TICKETS" | "PR";

/**
 * The canonical (code, context) -> message map for provider errors.
 * Context names the failed operation so the message explains what broke
 * without leaking raw provider bodies, headers, or internal trace text.
 */
export const PROVIDER_ERROR_COPY: Readonly<
  Record<
    ProviderErrorCopyCode,
    Readonly<Record<ProviderErrorCopyContext, string>>
  >
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

/** Resolves canonical copy for a (code, context) pair. */
export function getProviderErrorCopy(
  code: ProviderErrorCopyCode,
  context: ProviderErrorCopyContext,
): string {
  return PROVIDER_ERROR_COPY[code][context];
}
