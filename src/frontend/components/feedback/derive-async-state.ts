// src/frontend/components/feedback/derive-async-state.ts — Pure state derivation.
//
// Decided in #135 (spec #133 §Testing). Tested as a pure function over
// precedence: stale > loading > error > partial > empty. The primary state is
// the highest-precedence condition that is true; every other true condition
// is returned in `suppressed` — precedence never discards diagnostics.
//
// One refinement, recorded in docs/reference/state-coverage.md: `error` is
// PRIMARY only when the region has nothing to show (the query errored with no
// data). With data still on screen, a failed refresh rides along as a
// suppressed diagnostic rendered inline — the user keeps what still works
// (spec #133 user story 31) and still gets the normalized message + retry.

import type {
  AsyncQueryLike,
  AsyncRegionState,
  DeriveAsyncOptions,
  DerivedAsyncState,
} from "./types.js";

/** The precedence ladder. Order is the contract (#132). */
const PRECEDENCE: readonly AsyncRegionState[] = [
  "stale",
  "loading",
  "error",
  "partial",
  "empty",
];

/**
 * Derives the region state for one async query.
 *
 * - `loading` — no result yet: an initial fetch in flight (including a
 *   paused/offline retry). A background refetch with data on screen is NOT
 *   loading; the content stays visible.
 * - `error` — the query errored with nothing to show. With data on screen it
 *   becomes a suppressed diagnostic instead of hiding working results.
 * - `isStale` is INPUT staleness (displayed results were produced from inputs
 *   that are no longer current) — never TanStack Query's cache-freshness
 *   `isStale`, which this module never reads.
 */
export function deriveAsyncState(
  query: AsyncQueryLike,
  options: DeriveAsyncOptions = {},
): DerivedAsyncState {
  const conditions: Readonly<Record<AsyncRegionState, boolean>> = {
    stale: options.isStale?.(query) === true,
    loading: query.isPending && !query.isError,
    // Present for any query error — with data on screen it is never primary,
    // so it lands in `suppressed` and renders inline as a diagnostic.
    error: query.isError,
    partial: options.isPartial?.(query) === true,
    empty: options.isEmpty?.(query) === true,
    ready: false,
  };

  let primary: AsyncRegionState | undefined;
  for (const state of PRECEDENCE) {
    if (!conditions[state]) {
      continue;
    }
    // Error is primary only when the region has nothing to show.
    if (state === "error" && query.data !== undefined) {
      continue;
    }
    primary = state;
    break;
  }

  return {
    state: primary ?? "ready",
    suppressed: PRECEDENCE.filter(
      (state) => conditions[state] && state !== primary,
    ),
    error: query.isError ? query.error : undefined,
  };
}
