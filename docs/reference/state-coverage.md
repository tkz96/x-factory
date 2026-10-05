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
| Inspection — git identity (`#146`) | `wizard/steps/useInspection.ts` | loading = the identity read is in flight in the reserved region; empty = there is no directory to read a configuration in (nothing selected, or no local path at all — guidance names which); partial = the identity resolved for some selected repositories and not for others (the banner names each repository whose directory resolved none); error = the read failed (canonical copy + retry); stale = the record was resolved for a selection or workspace root that has since changed (badge + re-inspect). A record that resolved NO identity is not a failure of the region: the region renders normally and a banner states, with the directory named, that no `user.name`/`user.email` is configured and that none will be invented. |
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

**Inspection & Review staleness (`#146`).** The Inspection step records the
resolved identity together with the fingerprint of the INPUTS it was resolved
from — the workspace root, the selection and its order, and each selected
repository's role tags and local path (`inspectionRules.ts`, same digest
technique). The record is stale the moment any of those moves. Review derives
`isReviewReady` per render (never stored, #126) and is blocked while ANY value
downstream is not current: an unverified connection, a selection that is not an
application selection under the current connection, an identity that was never
resolved, an identity whose inputs moved, or an identity that resolved for only
some of the selected repositories. There is no dismissal path — only a fresh
verification (Connect) or a fresh inspection (Inspection) clears a blocked
reason, and Review lists every outstanding reason through the copy map.

**Degraded is usable, and never blocks (`#133`).** A verification result of
`degraded` is a VERIFIED connection with warnings, so it renders the partial
state and never withholds anything: #133 line 125 says "`degraded` → the partial
state (warning banner on the card), progression never blocked", line 136 repeats
"degraded renders the partial state, never blocks", and user story 19 asks for
"a warning on the card but never block progression". `isConnectionUsable` is
therefore true for `connected` and `degraded` alike, and there is no
acknowledgement to collect — the wizard carries no `degradedAccepted` field, and
`CONNECTIONS_COPY.stateLabel` has exactly one label per state. The warnings stay
VISIBLE in three places: the Connect card's partial banner (naming each
unconfirmed capability, with retry), the combo line's `degraded` state at Review
and on the post-creation surfaces, and the post-creation warning banner. This is
deliberately narrower than the staleness rule above: a STALE value still blocks,
and only re-verification clears it.

## Connection surfacing — the combo line and the integrity failure (#146/#147/#148)

Every surface that renders how a project is wired renders the same thing, from
one implementation:

- `components/connections/ConnectionComboLine.tsx` — THE presentational combo
  line (spec #133 story 48). It takes the slots to render (per role: a provider
  id and one of the three states), the line's tone, and the providers manifest.
  Display names come from the manifest's `displayName`, so no surface carries a
  provider id branch or a hardcoded id→name table, and a provider added by
  registry registration alone renders correctly.
- `components/connections/connection-state.ts` — the combo-line model
  (`ConnectionComboSlot`, `ConnectionComboTone`), the three-state derivation
  (`deriveConnectionState`), the usability predicate the Review gate reads, the
  ONE tone rule (`comboTone`), and `resolveProviderLabel`. Both producers of a
  line meet here.
- `components/projects/connection-integrity.ts` — the persisted-connections
  producer (`deriveConnectionIntegrity`) plus the combo-line mapping
  (`comboSlots`, `comboTone`), `connectionDisplayValues`, and
  `applyConnectionIntegrity`.
- `components/projects/connection-copy.ts` — resolves a derived warning to its
  copy-map message. The strings themselves live in `CONNECTIONS_COPY`.

**One implementation, one vocabulary (#148).** `ConnectionComboLine` is the only
rendering of the three-distinction combo line, and `comboTone` is its only tone
rule: the worst slot decides the tone, and a warning never takes the error tone.
The wizard's Review step renders the line from draft verification evidence
(`comboSlotFromEvidence` + `comboTone(slots, ["tracker", "gitHost"])` — Review
is the creation gate, so both roles are required); the post-creation surfaces
render it from a project's persisted `connections` (`comboSlots` +
`comboTone(integrity)`, which requires the tracker alone — a pre-#145 project's
absent git host is a warning, never an invented error). The two combo-line
renderings and the two copy structures that #146 and #147 produced in parallel
were collapsed into this one: `ComboSummary` and `CONNECTION_STATE_COPY` are
deleted, and `CONNECTIONS_COPY` is the single vocabulary — with one label per
slot state (`connected`, `degraded`, `disconnected`), because a degraded
connection is never gated on an acknowledgement.

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

**Known deviation — no composite connection identifier (recorded, not silent).**
Spec #133 story 34's example renders a connection as a provider name plus an
identifying configuration value ("Tracker: Jira (site.acme.net) · Git host:
GitHub (owner/repo)"). The combo line renders the provider's manifest
`displayName` and the role's state, and deliberately does NOT render the
parenthesised identifier. Rendering it needs provider-owned knowledge of which
config field identifies a connection — that is a new provider-contract
capability (`describeConnection`) plus a server-derived per-connection label on
the wire — which would amend the closed #137 provider contract and the #145
connection payload. Neither #146's nor #147's acceptance criteria require the
identifier; both require the git host and the tracker with the
degraded/disconnected distinctions, which this line implements. The gap is
recorded here as a deviation from the story's EXAMPLE, to be closed by a
provider-contract ticket if the capability is ever wanted — never by teaching
the UI which config field identifies a provider.

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

## Onboarding smoothness — the six criteria (#148)

The wizard's interaction contract, each rule with the test that fails if it
regresses. The criteria were decided with the flow (#130) and hardened as a
whole in #148; both framings are recorded because they describe the same
observable behaviour.

| # | Rule (ticket wording) | Spec #133 framing | Enforced by |
|---|---|---|---|
| 1 | No full modal re-render on verification completion: verifying one role rebuilds only that card | no remount on retry, form state preserved on failure, reserved-region spinners | `test/connect-step.test.tsx` — SMOOTHNESS #1 (a `MutationObserver` over the step reports which regions were structurally rebuilt; node identity proves the rest was not) |
| 2 | No full re-render on repository selection: selecting a row updates only what depends on the selection | no layout shift on load | `test/repositories-step.test.tsx` — SMOOTHNESS #2 (the only structural change is the selection summary; the list, the region and the request count are untouched) |
| 3 | Config-change invalidation is render-graph KEYING, never imperative query invalidation | stale data is never silent | `test/repositories-step.test.tsx` — SMOOTHNESS #3 (a new request for the new config, with the query client's `invalidateQueries`/`refetchQueries` watched) |
| 4 | Stale badges always re-check and clear only on a genuinely newer result, including after a draft restore | stale data never silent; restore marks results stale and revalidates | `test/inspection-step.test.tsx` — SMOOTHNESS #4 (a failed refresh keeps the badge and rides along as a suppressed diagnostic) and `test/repositories-step.test.tsx` — STALE (restored draft) |
| 5 | No wizard re-entry at Review completion: success closes the flow | no full-page flicker; nothing asks for re-entry | `test/review-step.test.tsx` — SMOOTHNESS #5 (reopening starts a fresh onboarding, never a resume of the submitted one) |
| 6 | No duplicate network requests on back-navigation | — | `test/inspection-step.test.tsx` and `test/review-step.test.tsx` — SMOOTHNESS #6 (Review ⇄ Inspection, Review ⇄ Repositories, Repositories ⇄ Connect) |

Two recordable consequences of the rules:

1. **A config change is a new query key, not an invalidation.** The connection's
   provider id and canonicalised config are digested into the query key
   (`connectionConfigFingerprint`), so an edit produces a different key and a
   fresh fetch, and the previous results are flagged out of date while it runs
   (`keepPreviousData`). No imperative `invalidateQueries` expresses "the inputs
   changed" anywhere in the wizard.
2. **A record that is already current for the current inputs is not re-read.**
   Entering Inspection again (a back-navigation, or a Review round trip) does not
   re-issue an identical read of evidence already on screen; a stale or missing
   record still re-reads, so the stale rule is unchanged. The skip is guarded by
   the inputs fingerprint, never by a blanket "read once" flag.

## Mutation regions — pending / success / error

Mutations (project creation, credential verification submits, pull-request creation) render through the same family: `pending` disables the invoking action (never a spinner takeover), `success` renders inline confirmation, `error` renders a `FeedbackBanner` (error tone) with copy-map copy and `RetryAction`. Rate-limited errors (`RATE_LIMITED` with `retryAfterMs`) disable the retry behind countdown guidance that ticks down once per second inside the banner (`use-retry-countdown`) — the retry un-disables itself, so the user never hammers the provider (spec user story 26).

| Region | Module | What the three states mean there |
|---|---|---|
| Review — project creation (`#146`) | `wizard/steps/useReviewSubmit.ts` | pending = the creation request is in flight: the submit is disabled and reads "Creating project…", every entered value stays rendered, and nothing remounts; success = the wizard completes (draft cleared, modal closed, the project present through the query cache — no reload, no re-entry); error = canonical copy with a working retry, entered data preserved. A semantic 409 renders its `formErrors`/`fieldErrors` codes through the copy map (a field is named by its descriptor label), a transport refusal and a network failure each get their own copy — a raw server message is never rendered. |

Required test coverage for every mutation region: pending, success, error.

## Input states — default / invalid / warning

Inputs render through `FieldFeedback`. The coverage contract requires testing `default`, `invalid`, and `warning` for every validated input; `valid` and `indeterminate` are additional presentation states. Frontend input validation is light client checking from descriptors (required/type) for instant feedback; authoritative validation stays server-side.

## Enforcement — honest scope

- `test/frontend-smoke.test.ts` gains a known-anti-pattern scan: ad-hoc spinner markup, ad-hoc generic error copy, and toast systems constructed outside `feedback/`. The scan DETECTS known anti-patterns; it does not PROVE coverage. Behavioral tests are the real enforcement.
- Three end-to-end provider journeys (`test/provider-journeys.test.tsx`) run the REAL wizard against a REAL server with a registry injected through the provider contract's own seam: GitHub-only, Azure dual-role, and Jira tracker-only (degraded evidence plus a git host from another provider). They are written provider-agnostically — the provider under test is DATA (`test/fixtures/journey-providers.ts`), and the api-client transport is the only boundary that stands in — and they assert the created project's persisted connections, its role-tagged repository, its `gitIdentity`, and that no secret appears in any response.
- The #148 read/mutation/input audit closed two gaps the earlier tickets left: the Connect step's own manifest region (`test/connect-step.test.tsx`) and the project detail surface's catalog region (`test/post-creation-surfacing.test.tsx`) now assert loading, error and empty, not only their ready and failure-of-connection states.
- The scan carries an explicit legacy allowlist (`LEGACY_ADHOC_FEEDBACK_FILES`) for files whose ad-hoc markup predates this contract and is scheduled for absorption by the wizard rebuild (spec #133). New files must never appear there, and entries leave the list when their absorbing ticket deletes them. `ProjectDetailView` and `QueueView` left it in #147.
- The feedback-family import rule (nothing screen-specific) is enforced by the same smoke gate.

## Adding a new region

1. Derive its state with `deriveAsyncState` and render through `AsyncRegion` — never construct loading/error markup by hand.
2. Pull all copy from `copy-map.ts`; extend the map rather than inlining strings.
3. Test all five read states (or the three mutation states, or the three input states) for the new region.
4. If the region errors with a normalized envelope, route the payload through `resolveErrorCopy` — raw error messages are never rendered.
