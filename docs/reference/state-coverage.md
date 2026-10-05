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
| Project detail (`#147`) | `views/ProjectDetailView.tsx`, `components/projects/TrackerSection.tsx` | loading = the projects catalog is in flight; error = the catalog failed (normalized copy + retry); empty = the catalog loaded without this id (not-found guidance + back action); ready = the project plus its combo line and tracker card. |
| Settings — connections registry (`#147`) | `views/SettingsView.tsx` | The registry lists every project with its combo line. Its loading and empty rows are table rows, not regions: they carry copy only. |
| Project cards (`#147`) | `components/projects/ProjectCard.tsx` | Not a region: each card renders its project's combo line and, on an integrity failure, the repair path. |
| Work Queue (`#147`) | `views/QueueView.tsx` | loading = tickets in flight; error = the tickets call failed (normalized copy + retry, and the manual path stays open); empty = the tracker reports no tickets (guidance + the manual path) or the search matches none (guidance + clear filter); ready = the ticket cards. |

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

## Post-creation connection surfacing — the combo line and the integrity failure (#147)

Every surface that renders how a project is wired renders the same thing, from
one implementation:

- `components/projects/ConnectionComboLine.tsx` — the presentational git host +
  tracker combo line (spec #133 story 48). It is driven purely by
  `Project.connections` (#145/#131) and the providers manifest; display names
  come from the manifest's `displayName`, so no surface carries a provider id
  branch or a hardcoded id→name table, and a provider added by registry
  registration alone renders correctly.
- `components/projects/connection-integrity.ts` — the pure derivation behind it
  (`deriveConnectionIntegrity`), plus `resolveProviderLabel`,
  `connectionDisplayValues` and `applyConnectionIntegrity`.
- `components/projects/connection-copy.ts` — resolves a derived warning to its
  copy-map message. The strings themselves live in `CONNECTIONS_COPY`.

**One implementation.** `ConnectionComboLine` is the only rendering of the
three-distinction combo line for persisted connections: it is presentational
(props only — integrity plus manifest), imports nothing wizard- or
screen-specific, and is importable from any surface, so the wizard's shared
summary line can adopt it rather than grow a second rendering.
`connection-integrity.ts` is the persisted-connections half of the state (the
wizard's own line reports *draft verification evidence* instead, and its
session-scoped rules belong to the wizard). If the wizard-side
`components/connections/ComboSummary` work (#146) lands, the two collapse into
one by mapping `ConnectionSlot` onto its `ConnectionEvidence` and deleting
whichever renderer is left unused — never by keeping both.

**The three distinctions.** A role's slot is `connected` (the ideal),
`degraded` (warnings present — warning tone, never the error tone) or
`disconnected`. Warnings are derived generically: an unrecorded role
(`ROLE_NOT_RECORDED`), a required non-secret configuration field the manifest
declares but the connection does not record (`CONFIG_INCOMPLETE` — secret
fields are never reported missing, since #131 strips them by design), or a
provider id the loaded manifest does not register (`PROVIDER_UNKNOWN`).
Nothing is reported before the manifest has loaded: an unloaded manifest must
never masquerade as a broken connection.

**The integrity failure.** `hasIntegrityFailure` holds exactly when no
connection serves the `tracker` role. Both connections are mandatory at
creation (#133 §Wizard flow & UX), so a project without a tracker is surfaced
as a durable configuration error with a repair path — **never** as an
empty state and never as a supported mode (spec #133 story 49). It renders on
all four surfaces through the feedback family: `AsyncRegion` (error tone,
`errorCopy` = the integrity copy, `retryLabel` = the repair label),
`FeedbackBanner`, and `RetryAction` as the repair affordance. `errorCopy` and
`retryLabel` are the region-level copy overrides added in #147, mirroring
`emptyCopy` / `emptyAction`; the raw payload is still never rendered.

**Precedence.** `applyConnectionIntegrity` promotes an integrity failure to the
primary error state over any asynchronous condition, because it is not an
asynchronous condition — the region cannot load at all. The derivation it
replaced is preserved in `suppressed` (minus `ready`), so no diagnostic is
silently dropped. On the Work Queue this is what keeps a tracker-less project
from reading as a successfully-empty queue.

**Legacy projects.** A project created before #145 has no `connections` array.
`deriveConnectionIntegrity` derives a display-only tracker descriptor from
`issueTracker` (looked up by the record's own provider id — not a provider
branch) and shows the git host as not recorded rather than inventing one. A
legacy project with no usable `issueTracker` is an integrity failure like any
other. Legacy descriptors are never reported as incomplete: their
configuration shape predates the normalized payload (spec #133 keeps legacy
config migration an open question).

**Repair path wiring.** The repair affordance is the copy-map `reconnect`
label. On the project detail surface, the project cards, and the Work Queue it
navigates to the settings connections surface; on that surface it opens the
connection flow (`openOnboardingModal`). Wizard re-entry / edit mode for an
existing project is out of scope for this spec (#133 §Further notes), so the
repair path leads to the surfaces where connections are established rather
than inventing a reconnect flow.

**Recorded limitation — the scope diagnostic.** The tracker card renders its
scope-verification action from the connection's *declared capabilities*
(`verifyScopes` in the manifest), never from a provider id. The action itself
still reaches `POST /api/projects/test-azure-scopes`, which resolves a
hardcoded provider and takes the provider config from the request body: a
client cannot supply the project's persisted secret (#131 keeps secrets
server-side), so the diagnostic can only succeed for payloads the server can
complete on its own. A provider-agnostic replacement needs a project-resolving
endpoint, which is outside #147's scope (the ticket owns the post-creation
frontend surfaces). The card renders only canonical copy for the outcome — the
raw provider scope payload is never rendered.

## Mutation regions — pending / success / error

Mutations (project creation, credential verification submits, pull-request creation) render through the same family: `pending` disables the invoking action (never a spinner takeover), `success` renders inline confirmation, `error` renders a `FeedbackBanner` (error tone) with copy-map copy and `RetryAction`. Rate-limited errors (`RATE_LIMITED` with `retryAfterMs`) disable the retry behind countdown guidance that ticks down once per second inside the banner (`use-retry-countdown`) — the retry un-disables itself, so the user never hammers the provider (spec user story 26).

Required test coverage for every mutation region: pending, success, error.

## Input states — default / invalid / warning

Inputs render through `FieldFeedback`. The coverage contract requires testing `default`, `invalid`, and `warning` for every validated input; `valid` and `indeterminate` are additional presentation states. Frontend input validation is light client checking from descriptors (required/type) for instant feedback; authoritative validation stays server-side.

## Enforcement — honest scope

- `test/frontend-smoke.test.ts` gains a known-anti-pattern scan: ad-hoc spinner markup, ad-hoc generic error copy, and toast systems constructed outside `feedback/`. The scan DETECTS known anti-patterns; it does not PROVE coverage. Behavioral tests are the real enforcement.
- The scan carries an explicit legacy allowlist (`LEGACY_ADHOC_FEEDBACK_FILES`) for files whose ad-hoc markup predates this contract and is scheduled for absorption by the wizard rebuild (spec #133). New files must never appear there, and entries leave the list when their absorbing ticket deletes them. `ProjectDetailView` and `QueueView` left it in #147.
- The feedback-family import rule (nothing screen-specific) is enforced by the same smoke gate.

## Adding a new region

1. Derive its state with `deriveAsyncState` and render through `AsyncRegion` — never construct loading/error markup by hand.
2. Pull all copy from `copy-map.ts`; extend the map rather than inlining strings.
3. Test all five read states (or the three mutation states, or the three input states) for the new region.
4. If the region errors with a normalized envelope, route the payload through `resolveErrorCopy` — raw error messages are never rendered.
