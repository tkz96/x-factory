# Antigravity Work Prompts — x-factory tri-provider rebuild (spec #133)

This file drives delegated implementation via the **Antigravity CLI** (`agy`, v1.2.16, model `gemini-3.8-flash-high`). Each ticket's prompt is fenced between `<<<PROMPT-NNN` and `PROMPT-NNN>>>` markers so it can be extracted verbatim and sent headless. The manager (Cline) runs the agent, reviews every PR, and owns git, PRs, and issue workflow.

## Sequence (strict order — respects every blocked-by edge)

| # | Ticket | Blocked by (all merged) |
|---|--------|------------------------|
| 1 | #137 Provider API surface: manifest, verify, parse-url | #134 ✓, #135 ✓, #136 ✓ |
| 2 | #138 GitHub provider module | #134 ✓, #137 |
| 3 | #139 Azure provider module | #134 ✓, #137 |
| 4 | #140 Jira provider module | #134 ✓, #137 |
| 5 | #141 Absorb-and-delete completion & provider-agnostic gate | #138, #139, #140 |
| 6 | #142 Wizard skeleton, Basics step & client drafts | #135 ✓, #137, #141 |
| 7 | #143 Connect step: dual connection cards & Quick-URL | #142 |
| 8 | #144 Repositories step: discovery-sourced selection | #143, #138 ✓, #139 ✓ |
| 9 | #145 Project creation: connections payload, env secrets & ordered writes | #141 |
| 10 | #146 Inspection & Review steps | #144, #145 |
| 11 | #147 Post-creation surfacing & no-tracker integrity error | #145 |
| 12 | #148 Journey hardening: six smoothness criteria & full gate pass | #146, #147 |

#149 (four open spec questions) is `ready-for-human` — excluded; not agent work. #133 is the parent spec, not itself implementable.

## How the manager runs one ticket

1. `git checkout -b feat/NNN-<slug> main` in `/Users/talhazuberi/x-factory`.
2. Extract the prompt: `sed -n '/^<<<PROMPT-NNN$/,/^PROMPT-NNN>>>$/p' work-prompts.md | sed '1d;$d' > /tmp/prompt-NNN.txt`
3. Launch headless in the background:
   `nohup ~/.local/bin/agy -p "$(cat /tmp/prompt-NNN.txt)" --model gemini-3.8-flash-high --output-format json --print-timeout 360m > /tmp/agy-NNN.json 2>/tmp/agy-NNN.err &`
4. Poll the output file + `git status` until the JSON envelope reports `SUCCESS` (or `WAITING` = permission stall → fix allow-list, then `--conversation <id>` to resume).
5. **Review** (see below). If findings: send numbered fix rounds with `--conversation <conversation_id> -p "<fix prompt>"`.
6. When clean: manager commits, runs the `/pr` skill to open the PR (body carries `Closes #NNN`), self-reviews the PR, posts the implementation report on the issue, merges, syncs main, runs `graphify update .`.
7. Next ticket in the sequence table.

## Review protocol (manager)

Two-axis review of every PR, matching the #134 post-merge standard:
- **Axis 1 — ticket compliance**: every acceptance criterion demonstrated with evidence, not asserted; report format honored; no criterion silently dropped.
- **Axis 2 — architecture**: AGENTS.md invariants (process boundaries, FSM, zero inline styles, modular CSS, docs authority); provider conditionals only inside provider modules; secrets/envKey never cross the HTTP boundary; error envelopes per contract; validation layering 400/409/500; no new dependencies; no weakened assertions.
- Gates re-run by the manager, never trusted from the agent's report alone.

## Definition of done (embedded in every prompt)

`bun run typecheck`; `bun run typecheck:frontend`; `bun run lint` (biome; known pre-existing noise: `ModalContainer.css`, `deliver-reconciliation.test.ts`); targeted `bun test` files then full `bun test` (known pre-existing: 4 `frontend-wizard-reset` full-suite failures that pass in isolation); `bun run test:frontend-smoke` for frontend tickets; `bun run test:integration` for API tickets; `bun run check:cycles` (0); `bun run check:knip` (0 new); `bun run check:fallow` (≥90 maintainability); `bunx fallow dupes` (no new clone groups).

---

# Ticket prompts

## #137 — Provider API surface: manifest, verify, parse-url (branch `feat/137-provider-api-surface`)

<<<PROMPT-137
You are implementing ticket #137 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/137-provider-api-surface. Do NOT switch, create, or commit branches.

FIRST read, in order:
1. AGENTS.md and docs/README.md — architectural authority; docs win over inference.
2. `gh issue view 137` (your ticket) and `gh issue view 133` (parent spec).
3. Code: src/providers/contract.ts, src/providers/registry.ts, test/provider-contract.test.ts, test/fixtures/stub-provider.ts (the contract, registry, extensibility gate and stub provider landed in #134 — you build on them, do not rework them).
4. src/server.ts and the existing integration tests in test/ — route registration, validation layering, and response-shape conventions to follow.
5. docs/reference/ for API contracts (api docs / OpenAPI spec if present — keep it updated with the new endpoints).

BUILD (from the ticket):
- A generic zod-to-descriptor serializer for provider configSchemas over a strictly defined subset of zod. On any schema construct outside the subset (unsupported methods, refinements the serializer cannot describe, missing field metadata, etc.) it must FAIL LOUDLY (typed error / thrown at test time), never silently drop or degrade a field.
- A serialization gate test that runs the serializer over every provider in the static registry — including stubs — so a bad schema fails CI, not production.
- Three endpoints:
  * GET /api/providers/manifest — descriptors with id, displayName, roles, iconRef, capabilities, configFields. Support role filtering (e.g. ?role=git-host). Cross-role field-name uniqueness validated in plain code. CRITICAL SECURITY INVARIANT: the response must never contain envKey or any secret metadata — write a test that asserts envKey absence explicitly; no provider text crosses the HTTP boundary.
  * POST /api/providers/verify — body selects a provider + role + config; response is the contract's VerificationResult (ideal, or degraded with warnings using contract capability names), or the normalized provider error envelope with its required context.
  * POST /api/providers/parse-url — body is a URL; response is { providerId, configDraft, inferredName } from the provider's parseQuickUrl, or an UNKNOWN envelope carrying the original URL in context.
- All three endpoints must be curl-demoable using the stub provider — provide a test (and a short demo script or doc snippet) proving the end-to-end flow with the stub.
- API validation layering respected and tested: transport validation (zod) rejects its own invalid input with 400; provider semantic validation rejects with 409; DB constraint violations surface as 500. Cross-layer tests prove each layer rejects its own invalid input.

HARD RULES:
- Never run git commit / git push / gh pr — leave all changes uncommitted in the working tree; your manager owns git and PRs.
- No new dependencies. Only libraries already in package.json.
- Respect AGENTS.md invariants: the API process never executes workflows or heavy pipeline stages; SQLite is the only source of runtime truth; docs/reference contracts win over inference.
- All user-facing copy through the copy map where applicable; contract capability names, never provider text, in any UI-facing payload.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass before reporting:
bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise you may ignore: ModalContainer.css, deliver-reconciliation.test.ts); bun test for your new test files then the full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation — any OTHER failure is yours to fix); bun run test:integration; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (maintainability >= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with exactly this:
1. Acceptance-criteria checklist: each ticket criterion with a pass/fail verdict + one line of evidence (test name or file).
2. Files created/modified/deleted.
3. Gate outputs: pass/fail per gate command.
4. Deviations from the ticket, if any, and why.
PROMPT-137>>>

## #138 — GitHub provider module (branch `feat/138-github-provider`)

<<<PROMPT-138
You are implementing ticket #138 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/138-github-provider. Do NOT switch, create, or commit branches.

FIRST read: AGENTS.md; docs/README.md; `gh issue view 138`; `gh issue view 133` (parent spec); the provider contract landed in #134/#135/#137: src/providers/contract.ts, src/providers/registry.ts, the provider-conformant stub in test/fixtures/stub-provider.ts, and the existing legacy client src/github.ts ONLY as behavioral reference. Then read the #129 nested-config discovery comments via `gh issue view 129` for the P0 bug context.

BUILD (from the ticket):
- src/providers/github-module.ts: a provider-conformant module registering as a GitHub provider — full zod configSchema (with envKey secret metadata on every secret field), capability declarations, verify, createPullRequest, parseQuickUrl. After registration the #137 manifest/verify/parse-url endpoints must serve it with zero edits to them.
- P0 nested-config discovery fix: the organization discovery path in the legacy src/github.ts treats nested configuration objects flat; detect nested-config ambiguity correctly (see #129) so distinct configurations are not silently collapsed. Port the fixed logic into the module's verify path, and prove it with tests derived from the #129 repro cases.
- toUserError: a 403 WITH rate-limit headers must map to the contract RATE_LIMITED error with retryAfterMs in the error context; a 403 WITHOUT those headers must map to a distinct permission/auth error that is different from invalid-credentials. Tests prove both mappings.
- parseQuickUrl: github.com/owner/repo parses into a git-host config draft + inferred name.
- createPullRequest: REST API primary; only on REST failure fall back to the gh CLI executable. The ticket-write path must never hard-depend on the gh CLI runtime. Use the shared create-only type-guard from the create-only safety family.
- Zero-mock tests EXCEPT at the HTTP boundary (stub the network, never the module internals). Include the nested-config discovery tests from #129.
- Scope: zero edits outside the provider module and the single registry import line.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies.
- AGENTS.md invariants; no GitHub-specific conditionals or text outside the provider module; contract capability names everywhere else.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test for your new files then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:integration; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-138>>>

## #139 — Azure provider module (branch `feat/139-azure-provider`)

<<<PROMPT-139
You are implementing ticket #139 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/139-azure-provider. Do NOT switch, create, or commit branches.

FIRST read: AGENTS.md; docs/README.md; `gh issue view 139`; `gh issue view 133`; src/providers/contract.ts, src/providers/registry.ts, test/fixtures/stub-provider.ts; the existing Azure module family (src/azure-config.ts, src/azure-connection.ts, src/azure-discovery.ts and their tests) as behavioral reference ONLY — most of it will be absorbed into your new module, but the absorb-and-delete is ticket #141, NOT yours; do not delete the old family in this ticket.

BUILD (from the ticket):
- src/providers/azure-module.ts: provider-conformant module — zod configSchema with envKey secret metadata, capability declarations, verify, createPullRequest, parseQuickUrl. After registration the #137 endpoints serve it with zero edits.
- H2 fix: organization vs orgUrl mismatch — detect that the configured organization and the org embedded in orgUrl are distinct configurations (also honoring the #129 nested-config detection requirements) and never silently conflate them. Tests prove the detection.
- Token acquisition stays internal to the module but the API shape is provider-agnostic: PAT → Basic auth, JWT → Bearer auth, and an Azure CLI credential fallback when no direct credential exists. Identity layer must not leak into the provider contract.
- CAPABILITY_UNCONFIRMED probes: when the token can read but not write (partial permission configuration), verify must return degraded with a CAPABILITY_UNCONFIRMED warning carrying contract capability names, not Azure text. Tests prove both the ideal and degraded paths.
- HTML-on-2xx normalization: an HTTP 200 whose body is HTML (auth wall / portal redirect) must be normalized to the correct user-facing error, never parsed as successful API JSON.
- parseQuickUrl: dev.azure.com/org/project parses into BOTH a git-host config draft and a tracker config draft with inferred name (pre-fills both role drafts).
- createPullRequest: REST-primary with the provider contract's PR creation caps; listRepositories implemented per the provider contract (serving the #137-era surface); REST-primary per-repo permission probes feeding the degraded/ideal classification.
- Zero-mock tests except at the HTTP boundary; the serializer gate from #137 must pass over your configSchema (your schema may only use the supported zod subset).
- Scope: zero edits outside the provider module and the single registry import line.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies.
- AGENTS.md invariants; no Azure-specific conditionals or text outside the provider module.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:integration; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-139>>>

## #140 — Jira provider module (branch `feat/140-jira-provider`)

<<<PROMPT-140
You are implementing ticket #140 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/140-jira-provider. Do NOT switch, create, or commit branches.

FIRST read: AGENTS.md; docs/README.md; `gh issue view 140`; `gh issue view 133`; src/providers/contract.ts, src/providers/registry.ts, test/fixtures/stub-provider.ts; the existing Jira module family (search test/ and src/ for jira modules, e.g. jira-config/jira-connection/jira-discovery and their tests) as behavioral reference ONLY — absorb-and-delete is ticket #141, not yours.

BUILD (from the ticket):
- src/providers/jira-module.ts: provider-conformant module — zod configSchema with envKey secret metadata, capability declarations, verify, listTickets, parseQuickUrl. After registration the #137 endpoints serve it with zero edits.
- SEARCH→SEARCH_JQL: the capability name SEARCH is replaced by SEARCH_JQL across contract, registry, stubs, and all consumers — no stale SEARCH references may survive. Update the stub provider and every consumer of the capability list, with tests proving the rename is complete.
- CAPTCHA→AUTH_LOCKED: Jira CAPTCHA responses must map to the contract AUTH_LOCKED normalized error with its required context (the legacy src/jira-api.ts family mapped them ad hoc — remove that mapping path from use, keep behavior). Tests prove the mapping.
- Probe warnings: partial or unconfirmed configuration aspects surface as probe warnings in verify results (degraded classification), never as silent assumptions.
- Jira has NO listRepositories (it is not a git host): degraded/partial handling must be honored — a partial registration that includes Jira as tracker with a git host that cannot list repos must flow through the degraded partial state without treating it as an error.
- parseQuickUrl: *.atlassian.net URLs parse into a tracker config draft with inferred name.
- listTickets with REQUIRED_WORKFLOW_LABEL: filter/flag tickets per the workflow-label requirement and return TrackerTicket structures per the contract.
- Zero-mock tests except at the HTTP boundary; the serializer gate must pass over your configSchema.
- Scope: zero edits outside the provider module, the capability-rename consumers, and the single registry import line.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies.
- AGENTS.md invariants; no Jira-specific conditionals or text outside the provider module.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:integration; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-140>>>

## #141 — Absorb-and-delete completion & provider-agnostic gate (branch `feat/141-absorb-and-delete`)

<<<PROMPT-141
You are implementing ticket #141 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/141-absorb-and-delete. Do NOT switch, create, or commit branches. This ticket merges to main AFTER #138, #139, #140 are all merged — you may assume their modules exist in the tree.

FIRST read: AGENTS.md; docs/README.md; `gh issue view 141`; `gh issue view 133`; all provider modules in src/providers/; the legacy families scheduled for deletion: the old trackers/ directory layer, the legacy discovery layer, the Azure module family (src/azure-*.ts), the old GitHub client (src/github.ts), the god-interface config union, and src/trackers/types.ts.

BUILD (from the ticket):
- Every consumer of provider functionality now dispatches through the provider registry + shared type-guards: scan the ENTIRE codebase for direct imports of the legacy families and rewrite each consumer (server, worker, frontend api-client, wizard, tests) to registry dispatch. No conditional provider branches anywhere outside provider modules — e.g. no `if providerId === 'github'` outside src/providers/, no Azure/Jira/GitHub-specific imports outside provider modules.
- Delete the legacy families: the trackers/ layer, the legacy discovery layer, the Azure module family, the old GitHub client, the god-interface config union, src/trackers/types.ts. Deletion is absorption: every behavior the legacy family provided must already be available through the registry modules (verify nothing regresses in the full test suite).
- Add a static gate that enforces provider-agnosticism mechanically — like the existing frontend-smoke inline-style allowlist gate, add a check (test or script run in CI) that fails if provider-specific conditionals or imports appear outside provider modules. The gate must run as part of the normal test/gate suite, not be skippable.
- Prove the deletions: bun run check:knip must report zero unused/rogue exports left behind by the deletions; bunx fallow dupes must not gain clone groups; bun run check:cycles must stay at 0.
- The provider contract's docs (docs/reference/) must reflect the post-absorption world: update any reference docs that mention the legacy families.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies.
- AGENTS.md invariants (FSM, process boundaries, docs authority). Do not weaken any existing assertion to make deletion pass — if a legacy test only made sense for the legacy family, DELETE it with the family; never port it hollow.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:integration; bun run test:frontend-smoke; bun run check:cycles (0); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted (deletions listed explicitly); 3) gate outputs; 4) deviations and why.
PROMPT-141>>>

## #142 — Wizard skeleton, Basics step & client drafts (branch `feat/142-wizard-skeleton-basics`)

<<<PROMPT-142
You are implementing ticket #142 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/142-wizard-skeleton-basics. Do NOT switch, create, or commit branches.

FIRST read: AGENTS.md; docs/README.md; DESIGN.md (Apple HIG spec); `gh issue view 142`; `gh issue view 133`; src/frontend/ structure, existing wizard tests in test/ (including the known-flaky test/frontend-wizard-reset.test.tsx — its full-suite failures pass in isolation and are tracked for THIS rebuild chain; you may restructure that test file as part of the skeleton), the api-client for the #137 endpoints (manifest/verify/parse-url), and src/frontend/styles/ layering (tokens.css → base.css → shared → utilities.css).

BUILD (from the ticket):
- New folder structure: src/frontend/wizard/ and src/frontend/connection/ with strict no-barrels import rules — modules import their own children directly, never through barrel files. Keep modules small: max ~3 exports per module.
- Thin orchestrator modal around the wizard (the modal itself must contain no step logic — steps own their state interactions through shared wizard context).
- useWizard: reducer + context holding ONLY the wizard's source-state (connection draft, repo selection, etc.) — no server state stored in wizard state (TanStack Query owns server state; SSE-driven cache updates continue to work per AGENTS.md).
- Five-step scaffold with strict state-machine progression (no skipping ahead, no backward-corruption of valid steps — revisit of a previously-valid step shows it valid, not reset).
- Basics step fully functional: project name + description with validation; the S3 fix applies — no hardcoded workspace path anywhere.
- Versioned client drafts: persist the full wizard draft at step boundaries into localStorage (client-only) with a schema version field; a stale schema version is discarded safely (never crashes, never partially loads).
- No secrets ever stored in client drafts — write a test asserting the persisted draft contains no secret/envKey fields.
- Zero inline styles (enforced by the existing smoke gate); all styling via design tokens, utility classes, or co-located component stylesheets under the modular CSS architecture.
- Journey tests updated: the wizard journey tests exercise the new skeleton (open wizard → Basics valid/invalid → next) without breaking existing journeys.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies. React 19 + Vite + React Router + TanStack Query + existing testing stack only.
- Zero inline styles in .tsx files; Lucide icons; Apple HIG per DESIGN.md; SSE + TanStack Query cache invariants per AGENTS.md.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (the 4 known frontend-wizard-reset full-suite failures are expected to remain or be resolved by your restructuring — any OTHER failure is yours); bun run test:frontend-smoke; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-142>>>

## #143 — Connect step: dual connection cards & Quick-URL (branch `feat/143-connect-step`)

<<<PROMPT-143
You are implementing ticket #143 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/143-connect-step. Do NOT switch, create, or commit branches. You may assume the #142 wizard skeleton is merged.

FIRST read: AGENTS.md; DESIGN.md; `gh issue view 143`; `gh issue view 133`; the wizard skeleton from #142 (src/frontend/wizard/, src/frontend/connection/); the api-client functions for the #137 endpoints (manifest with role filtering, verify, parse-url); the copy map module for user-facing strings; and the contract's capability names.

BUILD (from the ticket):
- Dual connection cards: one for the git host role, one for the tracker role, rendered from the filtered manifest (never from a hardcoded provider list — the UI stays provider-agnostic; the manifest drives which providers appear).
- Quick-URL: a single field per card that calls parse-url and pre-fills the config draft. It must accept at minimum github.com/..., dev.azure.com/... and *.atlassian.net URL shapes via the endpoint (no client-side provider parsing — the server owns parsing).
- Dual-role badge: a provider that can serve both roles shows a badge on both cards (e.g. Azure; still provider-agnostic — the badge derives from the manifest's roles array).
- Degraded partial state: a provider combination whose verify returns degraded with warnings must flow to the partial-state banner naming contract capability names from the warning — provider text never rendered.
- AUTH_LOCKED: a verify error of AUTH_LOCKED renders its copy-map message verbatim (no inline strings).
- Inline parallel verification: verify runs for both cards concurrently; the step is only valid when both connections resolve (verified ideal or accepted-degraded — a deliberate user choice on a degraded result must be recordable in wizard state).
- Server-authoritative validation: the client renders errors from the server's 400/409 envelopes (fieldErrors and formErrors rendered generically) — the client never re-implements provider validation rules.
- Per-state tests with api-client mocks: loading, verifying, ideal, degraded, AUTH_LOCKED, network error — each state rendered and asserted.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies. Zero inline styles; copy map for ALL user-facing strings; no provider conditionals outside provider modules (the frontend dispatches through the api-client + registry endpoints only).
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:frontend-smoke; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-143>>>

## #144 — Repositories step: discovery-sourced selection (branch `feat/144-repositories-step`)

<<<PROMPT-144
You are implementing ticket #144 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/144-repositories-step. Do NOT switch, create, or commit branches. You may assume #142/#143 are merged and that GitHub (#138) and Azure (#139) provider modules provide listRepositories.

FIRST read: AGENTS.md; DESIGN.md; `gh issue view 144`; `gh issue view 133`; the wizard from #142/#143; the provider contract's listRepositories shape; TanStack Query usage patterns in src/frontend/ (query keys, invalidation).

BUILD (from the ticket):
- The Repositories step lists repositories EXCLUSIVELY from the provider's listRepositories via the api-client — never from a local git scan, never hardcoded, never from any other source.
- Query keyed by connection config: the TanStack Query key must incorporate the connection configuration so a config change triggers a fresh query; the stale-key invalidation rule is enforced (old config's data must be invalidated, not reused).
- Five states, each with per-state tests:
  * Loading — spinner occupies a reserved region (no layout shift when data arrives).
  * Empty — guidance copy from the copy map when the connection lists zero repos.
  * Degraded partial — banner naming the missing capability via contract names when the provider cannot list repositories (e.g. Jira-as-tracker combinations or a degraded verify result).
  * Error with retry — failed fetch shows an error state with a working retry button (re-invokes the query, no remount of the wizard).
  * Stale badge — when the query returns stale data (e.g. background refetch running), a stale badge appears with a refresh action.
- Role-tagged selection: every repository row is tagged with the role(s) it satisfies (git host / tracker source); selecting repos records role-tagged selections in wizard state.
- Validation: at least one application repository must be selected before the step is valid — enforced in the wizard reducer, not just in UI hints.
- Journey tests: open wizard → valid Basics → valid Connect (mocked ideal verify) → Repositories list loads (mocked) → selection → next; plus each of the five states rendered.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies. Zero inline styles; copy map for all user-facing strings; SSE/TanStack cache invariants; no provider conditionals in frontend code.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:frontend-smoke; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-144>>>

## #145 — Project creation: connections payload, env secrets & ordered writes (branch `feat/145-project-creation`)

<<<PROMPT-145
You are implementing ticket #145 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/145-project-creation. Do NOT switch, create, or commit branches. You may assume #141 (absorb-and-delete) is merged — provider modules are the only provider path.

FIRST read: AGENTS.md; `gh issue view 145`; `gh issue view 133`; docs/reference/database-schema.md (durable schema authority); docs/reference/api.md or the OpenAPI spec (update it with the new endpoint); src/server.ts (route + validation layering patterns); src/providers/contract.ts + registry (secret metadata, envKey, capability checks); existing env/secret handling; the create-only family and clearSecrets contract hooks; the #129 nested-config comments; H4/H5 contexts in the spec.

BUILD (from the ticket):
- POST /api/projects with a connections payload (basics + verified git-host connection + verified tracker connection + repo selections per the wizard draft). Validation layering with cross-layer tests: transport 400 (zod on the request), semantic 409 (role/capability gate: e.g. tracker connection that cannot list tickets, duplicate project name), DB 500 (constraint violations) — each layer tested to reject its own invalid input.
- Generic env-secret writer: the server derives which fields are secrets from the provider's registered configSchema metadata (envKey); secrets are written to the process env / secret store generically — NO per-provider secret handling, and CRITICAL: envKey values must NEVER cross the HTTP boundary in either direction of any response. Test: request a project, then read every response the API can emit for it and assert no secret material appears.
- Ordered writes: secrets are written FIRST (idempotent, safe to re-run), project row LAST as the commit point; a failure mid-sequence leaves no orphan project. Test the ordering and the failure rollback/idempotency behavior.
- Role/capability gate 409: a connection whose capability set does not satisfy the role it is being registered under rejects with the semantic 409 envelope. Duplicate project name → 409 with its required context.
- Redaction-before-serialization: a redaction pass runs before ANY serialization of provider config data (shared type-guard from the redaction family); clearSecrets runs on teardown/refresh paths.
- H4 fix: the Jira config previously vanished mid-wizard — verified tracker config must persist through the wizard draft boundaries and into the created project.
- H5 fix: verified PATs previously did not persist across restarts — after creation, the stored connection must continue to verify without re-entry after a server restart (test with a fresh provider registry instance or equivalent).
- OpenAPI spec / API reference docs updated with the new endpoint and payload contract.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies. AGENTS.md invariants: API process does validation + persistence only; SQLite is the runtime truth; envKey never crosses HTTP; no provider conditionals outside provider modules (the writer is generic over schema metadata).
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo — tests must use the test DB fixtures the repo already provides.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:integration; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-145>>>

## #146 — Inspection & Review steps (branch `feat/146-inspection-review`)

<<<PROMPT-146
You are implementing ticket #146 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/146-inspection-review. Do NOT switch, create, or commit branches. You may assume #142–#145 are merged.

FIRST read: AGENTS.md; DESIGN.md; `gh issue view 146`; `gh issue view 133`; the wizard steps from #142–#144; the project-creation payload contract from #145 (your submit must wire the exact payload); the provider contract's summary/combo-line shape; docs/reference/state-machine-matrix.md for the run lifecycle the wizard precedes.

BUILD (from the ticket):
- Inspection step: shows the git identity derived from the worktree config (no hardcoded values); combo summary line combining both providers' connection summaries — degraded vs disconnected must be visually distinct states on that line (contract capability names, provider text only through the providers' own descriptors).
- Review step: blocked on stale downstream — if a downstream verification result is stale (config changed after verify, or the creation payload fails the role/capability gate), the Review step must be BLOCKED with the blocking reason surfaced; the ONLY way to unblock is re-verification, never a skip or bypass.
- Submit: wires the #145 creation endpoint with the exact payload derived from the wizard draft (basics + both connections + role-tagged repo selections); per-state submit tests: submitting, success, transport 400, semantic 409, network error — each state rendered and asserted.
- Smoothness criterion #5: after a failed submit, form state (user-entered fields and verification results) must be PRESERVED — retry never loses work; no full remount on retry.
- All user-facing strings from the copy map; zero inline styles; SSE-compatible success handling (project appears in the list without full-page flicker per AGENTS.md).

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies. Zero inline styles; copy map for all strings; no provider conditionals in frontend code.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:frontend-smoke; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-146>>>

## #147 — Post-creation surfacing & no-tracker integrity error (branch `feat/147-post-creation-surfacing`)

<<<PROMPT-147
You are implementing ticket #147 in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/147-post-creation-surfacing. Do NOT switch, create, or commit branches. You may assume #145 is merged.

FIRST read: AGENTS.md; DESIGN.md; `gh issue view 147`; `gh issue view 133`; the project header/settings/cards components in src/frontend/; the QueueView; the feedback primitives family (from #136 and earlier feedback-family work) — this ticket reuses them; the copy map.

BUILD (from the ticket):
- Combo line everywhere: the combined git-host + tracker summary line appears on the project header, settings view, and project cards. It must REPLACE any provider-conditional rendering (no `if providerId === X` branches in these components) — drive everything from the connection descriptors.
- Integrity failure state: when a project's connections fail the integrity check (e.g. no issue tracker connected), the UI must enter a dedicated integrity-failure state with a repair path (reconnect via the feedback primitives — reusing the EmptyStateCard-absorbed feedback family, not new ad hoc components) rather than a generic crash or silent degradation.
- QueueView: the "No Issue Tracker Connected" state must become the integrity failure state with the repair path (same primitives), not a dead-end message.
- Per-state tests: healthy (both connections ideal), degraded (warnings present), integrity failure (tracker disconnected) — each rendered and asserted, for header, settings, cards, and QueueView.
- Copy map for every string; zero inline styles; provider-agnostic rendering throughout.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: bun run typecheck; bun run typecheck:frontend; bun run lint (known pre-existing noise: ModalContainer.css, deliver-reconciliation.test.ts); targeted bun test then full `bun test` (known pre-existing: 4 frontend-wizard-reset full-suite failures that pass in isolation; any OTHER failure is yours); bun run test:frontend-smoke; bun run check:cycles (0 new); bun run check:knip (0 new); bun run check:fallow (>= 90); bunx fallow dupes (no new clone groups).

FINAL REPORT — end your response with: 1) acceptance-criteria checklist with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-147>>>

## #148 — Journey hardening: six smoothness criteria & full gate pass (branch `feat/148-journey-hardening`)

<<<PROMPT-148
You are implementing ticket #148 — the FINAL ticket of the #133 spec — in the x-factory repo at /Users/talhazuberi/x-factory (your current working directory), on the already-checked-out branch feat/148-journey-hardening. Do NOT switch, create, or commit branches. You may assume #142–#147 are all merged.

FIRST read: AGENTS.md; docs/README.md; `gh issue view 148`; `gh issue view 133` (full spec — this ticket closes it); the complete wizard chain (src/frontend/wizard/, src/frontend/connection/, all five steps); the test suite layout and coverage tooling; the six smoothness criteria in the spec (no layout shift on load; no remount on retry; form state preserved on failure; spinner reserved regions; no full-page flicker on SSE updates; stale-data visible as stale, never silent).

BUILD (from the ticket):
- Three provider journeys hardening — GitHub, Azure, Jira (stub provider where a real credential is unavailable) — each journey runs provider-agnostically: open wizard → Basics → Connect (each provider's real URL shapes through parse-url) → Repositories (listRepositories; Jira's partial state honored) → Inspection → Review → Submit → post-creation surfacing. Journeys must pass with test doubles only at the HTTP boundary — provider-agnostic tests, NO provider-conditional test logic.
- Six smoothness criteria: audit the whole wizard chain against each criterion and fix every violation; each criterion must have at least one test that fails if it regresses.
- Coverage split: unit coverage per step/component/state, journey coverage per provider, integration coverage for endpoint wiring. Overall suite coverage stays at/above the repo's established bar (>= 80% mandated; current > 97% — do not let it drop meaningfully).
- Full gate pass to close the spec: every gate green — typecheck (both), lint, full bun test with zero unexplained failures (the 4 known frontend-wizard-reset full-suite failures must be RESOLVED by this point in the chain — if they persist, fixing them is in scope for this ticket), frontend-smoke, integration, cycles 0, knip clean, fallow maintainability >= 90, dupes no new clone groups, plus `bun run test:integration:production`.
- Close-out sweep: no dead code, no TODO stubs left from the chain, no provider conditionals outside provider modules, docs/reference and docs/explanation updated to reflect the shipped wizard/provider architecture.

HARD RULES:
- Never run git commit / git push / gh pr. Leave changes uncommitted; your manager owns git and PRs.
- No new dependencies. Zero inline styles. Copy map for all user strings. Never weaken an assertion to make a gate pass — a gate that only passes by weakening is reported as blocked, not fixed.
- Do not touch x-factory.db, .runs/, .worktrees/, .agents/, .git, or anything outside the repo.

DEFINITION OF DONE — run and pass: every gate listed above, with the frontend-wizard-reset failures either resolved or explicitly reported as pre-existing with isolation-run evidence.

FINAL REPORT — end your response with: 1) acceptance-criteria checklist (all six smoothness criteria individually) with pass/fail + evidence; 2) files created/modified/deleted; 3) gate outputs; 4) deviations and why.
PROMPT-148>>>

---

*Manager note: after each merge, run `graphify update .` and post the implementation report on the issue before starting the next ticket in the sequence.*
