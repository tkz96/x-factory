# Project Setup UX Hardening — Blocker Ledger & Ticket Records

Running record of blockers encountered and per-ticket outcomes while working through
project setup UX tickets #159 → #160 → #161 → #162.

Workflow per ticket: Reproduce → RED (failing regression test) → find existing backend
capability → minimal fix → GREEN → real browser test → record → focused commit.

## Tooling / environment notes (pre-ticket)

- Antigravity computer-use: **not available** in this agent environment (no computer-use tool exposed).
- Reticle: daemon running on port 4400; `reticle_*` MCP tools reachable only through the
  `npx @reticlehq/server mcp` stdio proxy (no direct MCP tools exposed to this agent). A local
  CLI shim was written to call them. Reticle is **text/semantic only — it has no screenshot tool**.
- Playwright 1.63 + Chromium installed (home `node_modules`), used for viewport-matrix
  screenshots (visual inspection) and geometry measurement, which Reticle cannot provide.

---

<!-- TICKET RECORDS BELOW -->

# Ticket #159

## Reproduction

Opened the New Project Setup wizard from `http://localhost:5173/projects`
(`#btn-open-onboard-modal`) and measured the dialog with Playwright at 1280 / 1024 /
768 / 480 px, with short (Basics) and injected-tall content.

Observed:

- **Background scroll was never locked** — `document.body` had no `overflow: hidden`
  anywhere in the frontend, so the page behind the modal could become the scroll
  container.
- **Dialog dimensions shifted with content** — the dialog grew/shrank and re-centred
  between content states instead of holding one size.
- **Action bar lived inside the scrolling body** (`.wizard-actions`, a static last
  child) — with long content the Back/Next buttons were pushed off-screen.
- **The wizard used a parallel `.wizard-modal-*` abstraction** instead of composing the
  reusable `.modal-*` structure every other modal uses, so it did not inherit the shared
  modal guarantees.
- **Step nav clipped steps 4–5 at 480px** (`navScrollW 634 > navClientW 446`).

## RED

Test added: `test/wizard-modal-layout.test.tsx` (background scroll-lock contract +
accessible dialog semantics).

Failure observed: **4/4 failed.** Scroll-lock tests saw `document.body.style.overflow`
of `""` (expected `hidden`); the dialog-semantics test saw `role` on the overlay as
`null` (old markup put `role="dialog"` on the inner dialog, not the shared-modal
backdrop).

## Existing backend logic reused

Purely frontend. Reused the existing reusable modal infrastructure rather than a second
wizard-specific one:

- Shared modal classes from `components/ModalContainer.css`
  (`.modal-backdrop` / `.modal-dialog` / `.modal-header` / `.modal-body` /
  `.modal-actions`), already composed by `NewRunModal`, `DiffModal`, `DiagramModal`.
- A small reusable `useScrollLock` hook (structural modal behavior, available to any
  dialog). No backend/domain logic was involved or duplicated.

## Minimal fix

1. `WizardModal.tsx` composes the shared modal (`.modal-backdrop` with `role=dialog` on
   the backdrop, `.modal-dialog`, `.modal-header`, `.modal-body`), keeping the IDs the
   suite depends on. Deleted the parallel `.wizard-modal-*` CSS; `WizardModal.css` keeps
   only a `.wizard-modal-dialog` sizing modifier.
2. `useScrollLock(true)` in `WizardContent` (mounts only while open) → background locked
   while open, released on close.
3. Stable dimensions: `.wizard-modal-dialog { height: min(88vh, 720px); }`.
4. Persistent actions: steps switched `.wizard-actions` → shared `.modal-actions`
   (sticky + background). `.wizard-step-pane` became a full-height flex column with
   `.wizard-step-pane .modal-actions { margin-top:auto }` → bottom-aligns short steps,
   pins while scrolling long ones.
5. `StepNav` `flex-shrink:0` (never squeezed by a tall body).
6. Step-nav responsive: labels collapse to a numbered stepper below 667px so all five
   steps stay reachable at 480px (labels stay in the a11y tree).
7. Fixed a pre-existing token bug the browser test surfaced: active step number used
   `var(--primary)` (undefined → transparent, white "1" invisible) → `var(--accent)`.

## GREEN

- `test/wizard-modal-layout.test.tsx` → 4/4 pass.
- Wizard suites (`frontend-wizard-skeleton`, `repositories-step`, `connect-step`,
  `inspection-step`, `review-step`, `provider-journeys`, + new) → **103 pass / 0 fail**.
- `test/review-step.test.tsx` selector `.wizard-actions` → `.modal-actions` updated
  (structural rename; assertion unchanged, not weakened).
- `lint` exit 0, `typecheck` exit 0, `typecheck:frontend` exit 0.

## Browser verification

Playwright (`verify-159.ts`) against the running dev server, **ALL VIEWPORTS PASS** at
1280 / 1024 / 768 / 480:

- `scrollLocked` = true (body `overflow:hidden`, background does not scroll).
- `stableHeight` = true (dialog height identical for short vs injected-tall content).
- `bodyScrollsWithTall` = true (content scrolls inside `.modal-body`).
- `exceedsViewport` = false; `headerTop ≥ 0` (header persistent).
- `actionsVisible` = true even after scrolling the body to the bottom.
- `navOverflowX` = false at 480 (all 5 steps visible).

Visual inspection of screenshots (desktop, 1024, 768, 480 × short / tall / scrolled)
confirmed: stable dialog, persistent header + step nav, action bar pinned to the bottom,
internal scroll, dimmed + scroll-locked background, numbered stepper at 480.

## Blockers

- Reticle tour-scrim intercepted Playwright pointer events → Blocker record below.
- Pre-existing `var(--primary)` token bug (invisible active number) → Blocker record
  below.
- Initial `stableHeight:false` was a measurement artifact (entrance `scale(0.92)`
  animation read mid-flight: 648 = 704 × 0.92); resolved by waiting for the animation —
  not a real sizing defect.

## Result

PASS

---

## Blocker

- Ticket: #159
- Step: Real browser test (Playwright reproduction)
- Time/order: 1st ticket, browser step
- User action: Click `#btn-open-onboard-modal` to open the wizard
- Failure: Playwright click timed out; element intercepted by
  `<div class="reticle-tour-scrim is-clear">` from `<div data-reticle-tour>`
- Exact error: `TimeoutError: click: Timeout 30000ms exceeded … subtree intercepts
  pointer events`
- Environment/tool: Playwright 1.63 + Chromium vs. the Reticle presenter/tour overlay
  injected into the running app
- Root cause: Reticle's guided-tour scrim re-injects and swallows pointer events; it is
  test instrumentation, not app UI
- Existing capability that should have been reused: Reticle itself (`reticle_act*`)
  coexists with its own overlay — but Reticle is text-only and cannot capture the
  screenshots required for visual inspection, so Playwright was needed
- Workaround used: `page.addInitScript` MutationObserver setting
  `pointer-events:none; display:none` on `[data-reticle-tour], .reticle-tour-scrim`
- Why the workaround was not accepted as the fix: neutralizing an instrumentation overlay
  inside the driver is not an app defect and does not alter app code or the user's
  machine; it only clears Reticle's own HUD so the real UI can be driven and photographed
- Final resolution: overlay neutralized in the driver only; app code untouched
- Regression test: n/a (tooling); app-level contract covered by
  `test/wizard-modal-layout.test.tsx`
- Browser verification: screenshots captured and visually inspected at all 4 viewports

---

## Blocker

- Ticket: #159
- Step: Real browser test (active step visibility at 480px)
- Time/order: 1st ticket, browser step
- User action: View the numbered stepper at 480px after labels collapse
- Failure: Active step "1" rendered white-on-transparent → invisible (empty box)
- Exact error: computed `background: rgba(0, 0, 0, 0)` for
  `.wizard-step-button.active .wizard-step-number`; `var(--primary)` is undefined
- Environment/tool: Chromium devtools computed style
- Root cause: `StepNav.css` referenced a non-existent token `--primary`; correct tokens
  are `--accent` / `--color-primary` (in `styles/tokens.css`). Pre-existing bug masked
  because the visible text label used to identify the active step.
- Existing capability that should have been reused: the `--accent` design token
- Workaround used: none (fixed directly)
- Why the workaround was not accepted as the fix: n/a — corrected, not worked around,
  because the 480 numbered stepper depends on the number being visible
- Final resolution: `background: var(--primary)` → `background: var(--accent)`; verified
  computed `rgb(0, 122, 255)` and visually confirmed
- Regression test: `test/wizard-modal-layout.test.tsx` + browser inspection of
  `nav480.png`
- Browser verification: active "1" shown in a blue circle at 480px

---

# Ticket #160

## Reproduction

Opened the New Project Setup wizard from `http://localhost:5173/projects` and navigated
to Step 3 (Repositories).

Observed:

- **No bulk selection control**: Repositories had to be checked or unchecked individually;
  no master "Select all" / "Deselect all" control existed in the list header.
- **Missing indeterminate state**: No header checkbox existed to reflect partial row
  selections (checked when all selectable rows are selected, unchecked when none,
  indeterminate when some).
- **Unclear selection count**: No live feedback displayed how many repositories were selected
  relative to the total discovered (e.g. "0 of 3 selected", "3 of 3 selected").
- **Missing repository requirements explanation**: Users had no explanation of what qualifies
  as an application repository or why selecting at least one is required to proceed.
- **Unexplained disabled Continue button**: When progression was blocked (e.g. no application
  repository selected, stale results, or stale selection), the "Continue to Inspection" button
  was disabled without inline explanation.

## RED

Tests added in `test/repositories-step.test.tsx` (`describe("Repositories Step — bulk selection: Select all / Deselect all (#160)")`):

1. `SELECT ALL: unchecked at zero, selects every row, gates Continue with an inline reason`:
   asserted master `#repo-select-all` checkbox states (`checked=false`, `indeterminate=false`
   at 0; `checked=true`, `indeterminate=false` after bulk select; `checked=false`,
   `indeterminate=true` after partial deselect; `checked=false`, `indeterminate=false` after
   bulk clear), live count string `#repositories-selected-count` ("0 of 2 selected" →
   "2 of 2 selected" → "1 of 2 selected"), and `#repositories-continue-reason` inline copy.
2. `SELECTION COUNT: the recorded selection drives the count and the summary`: asserted live
   count updates on individual row toggle.
3. `HELPER TEXT: renders brief helper text explaining repository requirements (#160)`:
   asserted `#repositories-requirements-hint` exists and displays `REPOSITORIES_COPY.requirementsHelp`.

Failure observed: Initial absence of `#repo-select-all`, `#repositories-selected-count`,
`#repositories-requirements-hint`, and `#repositories-continue-reason` elements.

## Existing backend logic reused

- Discovery envelope: `api.providers.listRepositories` returning `RepositoriesEnvelope`
  with role-tagged repositories.
- State machines and validation: `canAdvanceFromRepositories` in
  `src/frontend/wizard/state/repositoryRules.ts` and `connectionConfigFingerprint` in
  `src/frontend/lib/connection-fingerprint.ts`.
- Design tokens and feedback primitives: `copy-map.ts` centralized UI strings,
  `FeedbackBanner`, and design system tokens.

## Minimal fix

Implemented on `main` in commits `faf72f4` and `e262509` and composed inside the updated
`<Modal>`/`<ModalFooter>` structure:

1. `useRepositoryDiscovery.ts`: added `allSelectableSelected`, `someSelectableSelected`,
   `totalRows`, `setAllRepositories(selected)` bulk action, and `continueBlockedReason`
   derivation (`"stale-results"` | `"stale-selection"` | `"needs-application-repository"`).
2. `RepositoriesStep.tsx`: added list header (`.repositories-list-header`) containing
   `#repo-select-all` checkbox (with `indeterminate` DOM ref sync) and
   `#repositories-selected-count` live counter. Added `#repositories-requirements-hint`
   helper text in step header. Added `#repositories-continue-reason` inline status
   rendered inside `<ModalFooter>`.
3. `RepositoriesStep.css`: added styles using design tokens for `.repositories-list-header`,
   `.repositories-select-all`, `.repositories-selected-count`,
   `.repositories-requirements-hint`, and `.repositories-continue-reason`.
4. `copy-map.ts`: added strings for `selectAllLabel`, `selectedOfTotal`,
   `needsApplicationRepository`, and `requirementsHelp`.

## GREEN

- `test/repositories-step.test.tsx` → 23 pass / 0 fail (all bulk selection and requirements tests passing).
- Full wizard test suite passing across all step and modal flows.
- Quality gate check (`bun run check:all`) → all 13 gates passed:
  - `typecheck`, `typecheck:frontend` exit 0.
  - `lint` exit 0.
  - `check:fallow`, `check:cycles`, `check:knip` exit 0.
  - `docs:schema:check`, `check:agent-docs` exit 0.
  - `build` exit 0.
  - `test:coverage` (full suite) exit 0 with >=80% coverage.
  - `test:frontend-smoke`, `test:integration`, `test:integration:production` exit 0.

## Browser verification

Playwright (`verify-160-viewports.mjs`) against the dev server with throwaway data dir and
isolated port lock (`/tmp/x-factory-browser.lock`). Verified at 1280, 768, and 480 px viewports:

- **1280px (Desktop)**:
  - State 1 (Initial): 0 of 3 selected; Select all unchecked & non-indeterminate; Continue disabled; `#repositories-continue-reason` displayed. Dialog width 678px, no horizontal overflow (`hasHorizontalOverflow: false`).
  - State 2 (Select all clicked): 3 of 3 selected; all row checkboxes checked; Select all checked; Continue enabled; blocked reason cleared.
  - State 3 (1 row deselected): 2 of 3 selected; Select all checkbox indeterminate (`indeterminate=true`, checked=false); Continue remains enabled.
  - State 4 (Deselect all): 0 of 3 selected; Select all unchecked; Continue disabled; blocked reason re-appears.
- **768px (Tablet)**:
  - All states verified identically. Dialog width 678px, height 718px, header and action bar stable, no horizontal overflow.
- **480px (Mobile)**:
  - All states verified identically. Dialog width 446px, height 702px.
  - Stepper labels collapse to numbered circles (all visible).
  - List header flex layout preserves checkbox and counter alignment without clipping.
  - Repository URLs truncate with ellipsis cleanly; action buttons wrap cleanly in modal footer.
  - Visual inspection of screenshots confirmed clean styling and zero visual clipping.

## Blockers

- Reticle tour scrim and presenter widget intercepted Playwright pointer clicks. Neutralized
  in the driver init script via MutationObserver (`display:none !important; pointer-events:none !important`)
  and direct DOM dispatch so real app UI could be driven and photographed cleanly.
- Worker database migration race during simultaneous startup on fresh throwaway data directory.
  Resolved by pre-initializing migrations via `createDatabase()` before launching dev server.

## Result

PASS




