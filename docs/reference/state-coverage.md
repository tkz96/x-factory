# Async State Coverage Contract

This document is the durable contract for feedback state coverage across every user-facing region of X-Factory. It was decided in resolution #132 and implemented in ticket #135 (spec #133). `AGENTS.md` and `docs/reference/` govern architecture; behavioral tests are the real enforcement of this contract.

## The feedback family

All async and input feedback renders through the presentation-only family at `src/frontend/components/feedback/`:

- `AsyncRegion` — renders the five-state taxonomy from a derived state enum. It never sees the query.
- `FieldFeedback` — inline input states: `valid | invalid | warning | indeterminate` (plus `default`, which renders nothing).
- `FeedbackBanner` — inline partial/degraded warnings and rate-limit timed guidance, with `role="status"` semantics.
- `RetryAction` — the uniform retry affordance.
- `copy-map.ts` — THE canonical `(code, context) → message` map plus the five-state guidance strings. All canonical copy lives there, nowhere else.

Import rule: any component may import `feedback/`; `feedback/` imports nothing screen-specific (enforced by the smoke gate). All feedback renders inline in its region — there is no toast system, ever.

## Read regions — loading / empty / partial / error / stale

State derivation is pure: `deriveAsyncState(query, { isEmpty, isPartial, isStale })` in `derive-async-state.ts`. Precedence is fixed: **stale > loading > error > partial > empty**. The primary state is the highest-precedence condition that is true; every other true condition is returned in `suppressed` — **precedence never discards diagnostics**.

| State | Definition | Presentation |
|---|---|---|
| `loading` | No result yet — an initial fetch in flight (or paused/offline). A background refetch with data on screen is NOT loading. | Indeterminate spinner in a reserved region (`min-height` from spacing tokens, no layout shift). No skeleton or shimmer, ever. |
| `empty` | The region has results but none are usable (caller predicate `isEmpty`). | Guidance text from the copy map, overridable per region via props. |
| `partial` | Some results loaded and others failed (caller predicate `isPartial`). | Content stays on screen plus a warning banner listing exactly which parts failed (`failedParts`), so the user knows what still works. |
| `error` | The query failed AND the region has nothing to show. | Normalized message from the copy map + `RetryAction`. Never a raw provider body. |
| `stale` | Displayed results were produced from inputs that are no longer current (caller predicate `isStale`). This is INPUT staleness — never TanStack Query's `isStale`, which reports cache freshness. | Content stays on screen plus the visible "Out of date" badge and a Refresh action. Stale blocks Review until refreshed (wizard concern). |

Two recorded refinements:

1. **Error with data on screen is a suppressed diagnostic, not a primary state.** A failed refresh never hides working results; the error renders inline as a banner with a retry, carried in `suppressed`. The canonical case: stale + failed refresh → stale badge + error context + retry.
2. **Loading means "no result yet."** An enabled-but-not-started query shows the reserved spinner region; consumers that gate a region (for example, a wizard step waiting on upstream inputs) simply do not render the region until it is live.

Required test coverage for every read region: loading, empty, partial, error, stale.

## Implemented read regions

| Region | Module | What the five states mean there |
|---|---|---|
| Connect — provider manifest | `wizard/steps/useConnectStep.ts` | loading = manifest in flight; error = manifest unavailable; retry refetches. |
| Repositories — git-host discovery (`#144`) | `wizard/steps/useRepositoryDiscovery.ts` | loading = discovery in flight in the reserved region; empty = the connection lists no repositories (guidance copy); partial = the connection's verification could not confirm `listRepositories` (banner names the capability); error = the provider call failed (normalized copy + retry); stale = the displayed results or the recorded selection were produced from a git-host connection configuration that is no longer current. |

**Repositories staleness (`#144`).** The step records the fingerprint of the
git-host connection (provider id + config values, in
`lib/connection-fingerprint.ts`) that produced the current selection. The
selection is stale the moment that fingerprint no longer matches the connection
as it stands — a provider or config edit, or a restored draft whose credentials
were stripped. A stale selection shows the badge and the refresh affordance,
and blocks the step: the reducer's `NEXT_STEP` guard refuses to move past step 3
while it holds, so a project can never be created from a selection made under a
connection that has since changed. Report/Review stale-blocking (#146/#147)
builds on the same rule.

## Mutation regions — pending / success / error

Mutations (project creation, credential verification submits, pull-request creation) render through the same family: `pending` disables the invoking action (never a spinner takeover), `success` renders inline confirmation, `error` renders a `FeedbackBanner` (error tone) with copy-map copy and `RetryAction`. Rate-limited errors (`RATE_LIMITED` with `retryAfterMs`) disable the retry behind countdown guidance that ticks down once per second inside the banner (`use-retry-countdown`) — the retry un-disables itself, so the user never hammers the provider (spec user story 26).

Required test coverage for every mutation region: pending, success, error.

## Input states — default / invalid / warning

Inputs render through `FieldFeedback`. The coverage contract requires testing `default`, `invalid`, and `warning` for every validated input; `valid` and `indeterminate` are additional presentation states. Frontend input validation is light client checking from descriptors (required/type) for instant feedback; authoritative validation stays server-side.

## Enforcement — honest scope

- `test/frontend-smoke.test.ts` gains a known-anti-pattern scan: ad-hoc spinner markup, ad-hoc generic error copy, and toast systems constructed outside `feedback/`. The scan DETECTS known anti-patterns; it does not PROVE coverage. Behavioral tests are the real enforcement.
- The scan carries an explicit legacy allowlist (`LEGACY_ADHOC_FEEDBACK_FILES`) for files whose ad-hoc markup predates this contract and is scheduled for absorption by the wizard rebuild (spec #133). New files must never appear there, and entries leave the list when their absorbing ticket deletes them.
- The feedback-family import rule (nothing screen-specific) is enforced by the same smoke gate.

## Adding a new region

1. Derive its state with `deriveAsyncState` and render through `AsyncRegion` — never construct loading/error markup by hand.
2. Pull all copy from `copy-map.ts`; extend the map rather than inlining strings.
3. Test all five read states (or the three mutation states, or the three input states) for the new region.
4. If the region errors with a normalized envelope, route the payload through `resolveErrorCopy` — raw error messages are never rendered.
