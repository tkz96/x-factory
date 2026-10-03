// src/frontend/components/feedback/types.ts — Shared types for the feedback family.
//
// Decided in #135 (spec #133, resolution #132). The feedback family is
// presentation-only: any component may import it, it imports nothing
// screen-specific, and it never sees a query — consumers derive state with
// `deriveAsyncState` and hand the result to `AsyncRegion`.

// ---------------------------------------------------------------------------
// Async region taxonomy (#132)
// ---------------------------------------------------------------------------

/**
 * The five-state async taxonomy every fetching region renders —
 * `loading | empty | partial | error | stale` — plus `ready`, the state in
 * which the region renders its content with no feedback chrome.
 */
export type AsyncRegionState =
  | "ready"
  | "loading"
  | "empty"
  | "partial"
  | "error"
  | "stale";

/**
 * Result of `deriveAsyncState`. `suppressed` lists every condition that
 * evaluated true but lost to a higher-precedence one, in precedence order —
 * precedence never discards diagnostics: a stale region whose refresh failed
 * derives `state: "stale"` with `"error"` suppressed alongside it, so the UI
 * shows the stale badge, the normalized error message, and a retry.
 */
export interface DerivedAsyncState {
  readonly state: AsyncRegionState;
  readonly suppressed: readonly AsyncRegionState[];
  /**
   * The query's error payload when an error condition is present (primary or
   * suppressed). Components resolve it through the copy map; a raw payload
   * is never rendered directly.
   */
  readonly error: unknown;
}

/**
 * The minimal structural slice of a TanStack Query result the derivation
 * needs. Deliberately excludes TanStack's own `isStale` (cache freshness) so
 * cache staleness can never masquerade as input staleness — see
 * `DeriveAsyncOptions.isStale`. Any `UseQueryResult` satisfies this shape.
 */
export interface AsyncQueryLike {
  readonly data: unknown;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
}

/** Predicates for `deriveAsyncState`; all optional, all consulted. */
export interface DeriveAsyncOptions {
  /** True when the region has results but none of them are usable. */
  isEmpty?: (query: AsyncQueryLike) => boolean;
  /** True when some results loaded and others failed. */
  isPartial?: (query: AsyncQueryLike) => boolean;
  /**
   * True when the displayed results were produced from inputs that are no
   * longer current. This is INPUT staleness — never TanStack Query's
   * `isStale` (which reports cache freshness). It falls out of query-key
   * invalidation when keys derive from upstream inputs (spec #133 §State
   * management): key change → new fetch → old results are out of date.
   */
  isStale?: (query: AsyncQueryLike) => boolean;
}

// ---------------------------------------------------------------------------
// Normalized error envelope (wire-compatible with #129)
// ---------------------------------------------------------------------------

/**
 * The closed error-code set from the provider contract (#129). Re-declared
 * here — never imported from `src/providers/contract.ts` — because the
 * frontend must not import provider code (spec #133 §Provider-agnosticism).
 * #139's API layer emits these on the wire; the sets must stay in sync with
 * the contract's runtime guard.
 */
export type FeedbackErrorCode =
  | "AUTH_INVALID"
  | "AUTH_LOCKED"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "PERMISSION"
  | "UNKNOWN";

/** The failed operation. Required — there is no fallback context (#129). */
export type FeedbackErrorContext = "VERIFY" | "DISCOVERY" | "TICKETS" | "PR";

/**
 * Wire-compatible with `ProviderError` (src/providers/contract.ts): the
 * normalized error envelope every error state renders through the copy map.
 * `retryAfterMs` is provider-computed, positive, milliseconds, and present
 * only when actually known.
 */
export interface NormalizedError {
  readonly code: FeedbackErrorCode;
  readonly context: FeedbackErrorContext;
  readonly retryAfterMs?: number;
}

// ---------------------------------------------------------------------------
// Input feedback states (#132)
// ---------------------------------------------------------------------------

/**
 * Input feedback states. The state-coverage contract requires default /
 * invalid / warning to be tested; `valid` and `indeterminate` are additional
 * presentation states (`indeterminate` = a check is running or cannot be
 * determined yet).
 */
export type FieldFeedbackState =
  | "default"
  | "valid"
  | "invalid"
  | "warning"
  | "indeterminate";
