#!/bin/bash
set -e

gh issue edit 109 --title "Backend: create-only project persistence" --body '## Problem
The project creation endpoint `POST /api/projects` uses `saveProject()`, which silently updates/upserts an existing project if the ID matches. This risks data loss during onboarding if a duplicate ID is submitted.

## Desired behavior
Introduce a create-only persistence path (`createProject()`) that rejects an existing ID with a `ConflictError` (HTTP 409). `saveProject()` must remain unchanged for existing project updates and migration.

## Scope
Backend configuration layer (`config.ts`), `POST /api/projects` route.

## Acceptance criteria
- [ ] A new `createProject` function exists in the backend that loads existing projects, validates the input, and throws a `ConflictError` if the ID exists.
- [ ] `POST /api/projects` uses `createProject` and returns a `409 Conflict` on duplicates.
- [ ] No configuration changes are made when the ID already exists.
- [ ] A new project is saved correctly when the ID is new.
- [ ] `PUT /api/projects/:id` and `PATCH /api/projects/:id` continue using `saveProject()`.
- [ ] Migration behavior remains unchanged.
- [ ] Existing data remains byte-for-byte/configuration-equivalent after a rejected creation where practical.

## Tests required
- [ ] Test successful new creation.
- [ ] Test duplicate creation yields 409 Conflict without overwriting data.
- [ ] Test update regression (existing update flows work).
- [ ] Test migration regression.

## Dependencies/blockers
None.

## Important architectural constraints
**Do not change `saveProject()` from its upsert behavior.**
'
echo "Updated 109"

gh issue edit 110 --title "Wizard: live repository discovery" --body '## Problem
The wizard'"'"'s Step 3 (Repository Discovery) currently shows a static placeholder and does not call the backend discovery API.

## Desired behavior
The wizard must explicitly invoke `POST /api/projects/discover-repositories` when Step 3 is entered to fetch real repository data.

## Scope
Frontend wizard Step 3 and discovery API client.

## Acceptance criteria
- [ ] Discovery occurs automatically when Step 3 is first entered.
- [ ] The request uses the wizard'"'"'s current connection data: `provider: "azure"`, `orgUrl`, `project`, and `pat`.
- [ ] Navigating back and forward does not create unnecessary duplicate discovery requests.
- [ ] The UI provides an explicit retry path.
- [ ] The UI displays a loading state during discovery.
- [ ] The UI displays an empty result state if 0 repositories are found.
- [ ] The UI displays an error state if discovery fails.
- [ ] Discovery results are preserved in wizard state.
- [ ] Discovered repository `id`, `name`, `remote`, `defaultBranch`, and `webUrl` are preserved where available.
- [ ] The PAT is used for the discovery request but must **never** be persisted in the project object or included in the final project creation payload.

## Tests required
- [ ] Test successful discovery.
- [ ] Concrete test case: `https://dev.azure.com/xynotech/Converso/` must discover all **14 repositories** currently returned by the backend.
- [ ] Test empty repository result state.
- [ ] Test authentication/discovery failure state.
- [ ] Test retry path.
- [ ] Test that ordinary rendering/navigation does not cause duplicate requests.

## Dependencies/blockers
None.

## Important architectural constraints
Do not implement repository selection in this issue (that is handled in Step 4). The PAT must never be persisted.
'
echo "Updated 110"

gh issue edit 111 --title "Wizard: intelligent duplicate-project detection" --body '## Problem
The wizard lacks UI-level duplicate project detection. It silently proceeds if an existing project URL/ID is pasted, eventually failing at the backend.

## Desired behavior
Detect already-onboarded projects before submission by comparing wizard inputs against existing projects. Provide a clear path to inspect the existing project.

## Scope
Frontend wizard quick-URL parsing and step navigation.

## Acceptance criteria
- [ ] Exact local project ID collision (Existing `converso` vs New `converso`): Block creation.
- [ ] Same external project with different local ID (Existing Azure `xynotech/Converso` vs New Azure `xynotech/Converso`): Recognize the existing external project and block creation.
- [ ] Same local ID but different external target (Existing Azure `company-a/Converso` local ID `converso` vs New Azure `xynotech/Converso` local ID `converso`): Block creation due to ID conflict, but distinguish this visually from "the same external project."
- [ ] The frontend uses deterministic normalization for project IDs, provider identifiers, Azure org URL, Azure project name, GitHub owner/repo, and discovered remotes to compare identity.
- [ ] The UI detects duplicates before final submission.
- [ ] The UI clearly identifies what matched.
- [ ] The UI provides a way to inspect/open the existing project.
- [ ] Avoid false positives from merely similar names (do not claim arbitrary URLs are equivalent without normalization rules).
- [ ] Accounts for archived projects via `useProjects()` or backend check since backend validation operates on all persisted projects.

## Tests required
- [ ] Test exact local project ID collision.
- [ ] Test same external project with different local ID.
- [ ] Test same local ID but different external target.
- [ ] Test normalization correctly prevents false positives.

## Dependencies/blockers
- Blocked by: #109 (Backend: create-only project persistence)

## Important architectural constraints
This frontend check is a UX safeguard and must **not** replace the backend 409 conflict safety boundary established in #109.
'
echo "Updated 111"

gh issue edit 112 --title "Wizard: repository selection and configuration" --body '## Problem
Step 4 currently shows a static placeholder for a single repository instead of allowing configuration of the discovered repositories.

## Desired behavior
Step 4 must display all discovered repositories and allow the user to select, configure paths and roles, and designate exactly one primary repository.

## Scope
Frontend wizard Step 4 (Repositories).

## Acceptance criteria
- [ ] Step 4 displays all repositories discovered by the discovery API.
- [ ] The user can select/deselect multiple repositories.
- [ ] The user can designate exactly one primary repository (persisted as the first repository in the configured `repositories` array).
- [ ] Discovered repository `id`, `name`, `remote`, and `defaultBranch` are preserved.
- [ ] The user can provide an independent local path for each selected repository.
- [ ] An initial role is assigned using the existing `inferRepoRole()` logic, and the user can manually adjust the role.
- [ ] Duplicate repository IDs are prevented.
- [ ] The wizard prevents an invalid configuration with zero selected repositories.
- [ ] The wizard prevents an invalid primary-repository configuration.
- [ ] Non-selected discovered repositories are kept out of the final configuration.

## Tests required
- [ ] Test selecting multiple repositories.
- [ ] Test selecting/deselecting repositories.
- [ ] Test changing the primary repository (ensuring it updates the array order).
- [ ] Test role inference and manual role changes.
- [ ] Test independent local paths.
- [ ] Test branch and remote preservation.
- [ ] Test validation for invalid selections (zero selected, invalid primary).

## Dependencies/blockers
- Blocked by: #110 (Wizard: live repository discovery)

## Important architectural constraints
The current `Project` type does **not** contain an `isPrimary` repository property (it relies on `project.repositories[0]`). **Do not introduce an `isPrimary` field merely to implement this issue.** Persist the primary repository as the first element of the array without modifying the underlying domain schema.
'
echo "Updated 112"

gh issue edit 113 --title "Wizard: repository inspection and readiness" --body '## Problem
The wizard does not inspect selected repositories to show their local status before completing the onboarding flow.

## Desired behavior
Step 5 must call the existing repository inspection endpoint for all configured repositories and accurately display their local readiness status. A missing local repository is not automatically an invalid project.

## Scope
Frontend wizard Step 5 (Inspection).

## Acceptance criteria
- [ ] Step 5 inspects every selected repository using the existing `POST /api/projects/inspect-repository` endpoint.
- [ ] The UI displays per-repository results.
- [ ] The UI distinguishes between: `ready`, `pending_setup` (missing checkout), non-Git directory / `error`, and inspection/API failure.
- [ ] The UI clearly explains the status for each repository.
- [ ] The UI prevents completion when the configuration itself is invalid.
- [ ] The UI allows `pending_setup` repositories to remain configured if the domain model permits them (they do not rigidly block project creation).
- [ ] Inspection failure is not falsely displayed as readiness.
- [ ] The exact final gating rule follows the existing `RepositoryReadiness` semantics.

## Tests required
- [ ] Test all readiness states (ready, pending setup, non-Git/error, API failure).
- [ ] Test that `pending_setup` repositories do not block completion incorrectly.
- [ ] Test final navigation behavior blocks correctly when configuration is genuinely invalid.

## Dependencies/blockers
- Blocked by: #112 (Wizard: repository selection and configuration)

## Important architectural constraints
**Do not make "every selected repository must already be locally ready" a mandatory condition for project creation.** Do not duplicate the entire project-readiness implementation in the frontend.
'
echo "Updated 113"

gh issue edit 114 --title "Wizard: accurate review and multi-repository project creation" --body '## Problem
The wizard'"'"'s final Review step reflects static data and sends a hardcoded single-repository payload to the backend.

## Desired behavior
The Review step must display actual selected repository state, and the final payload must construct the full multi-repository configuration without secrets.

## Scope
Frontend wizard Step 6 (Review) and final `POST /api/projects` submission logic.

## Acceptance criteria
- [ ] The Review step displays the actual configured repository state: project name, project ID, provider/tracker, repository count, repository names, primary repository, roles, local paths, default branches, and relevant remotes.
- [ ] The final `POST /api/projects` payload contains every selected repository.
- [ ] Each repository'"'"'s configured metadata is preserved.
- [ ] The configured primary repository ordering is used (primary is the first element).
- [ ] The hardcoded single-repository construction is removed.
- [ ] The complete multi-repository project is created successfully.
- [ ] Existing tracker configuration behavior is preserved.
- [ ] **No PAT or other secret is contained in the project creation payload.**

## Tests required
- [ ] Test review UI reflects correct multi-repo configuration.
- [ ] Test final payload structure.
- [ ] Concrete test case: The Azure Converso case with 14 discovered repositories must correctly create a project containing all 14 configured repositories.

## Dependencies/blockers
- Blocked by: #112 (Wizard: repository selection and configuration)

## Important architectural constraints
The builder payload depends on configured state, not inspection status. Do not send sensitive tokens (PATs) in the project creation payload.
'
echo "Updated 114"

gh issue edit 115 --title "Backend: Azure discovery authentication/error handling" --body '## Problem
Azure authentication failures (like invalid PATs) can return an HTML login/redirect response instead of JSON. The backend currently forwards this leading to a confusing "JSON parse error" in the UI.

## Desired behavior
The backend must handle Azure authentication and API failures robustly and return clear, user-facing error messages instead of raw HTML.

## Scope
Backend discovery logic (`azure.ts`), handling Azure DevOps API error responses.

## Acceptance criteria
- [ ] Authentication failures (where Azure returns an HTML login/redirect response instead of expected JSON API response) are caught.
- [ ] The resulting error is clear and user-facing, e.g., "Azure DevOps authentication failed. Verify your Personal Access Token."
- [ ] Raw HTML is never exposed.
- [ ] Correctly covers HTTP 401, 403, redirect/login HTML, non-JSON error responses, 404 project, and other Azure API errors.
- [ ] Correctly covers malformed successful responses.
- [ ] The existing successful 14-repository discovery behavior is unchanged.

## Tests required
- [ ] Test invalid PAT yielding HTML redirect.
- [ ] Test HTTP 401/403.
- [ ] Test 404 project not found.
- [ ] Test malformed API responses.

## Dependencies/blockers
None.

## Important architectural constraints
Do not introduce HTTP-specific error types into the discovery/domain layer unless existing architecture requires it. Contains **only** backend error handling logic.
'
echo "Updated 115"

gh issue create --title "Wizard: Explicitly reset onboarding state and sensitive fields" --body '## Problem
The wizard reset currently depends on React component unmount behavior to clear its state. This implicit reset should be made explicit for defense-in-depth security, ensuring sensitive fields like PATs are guaranteed to be destroyed.

## Desired behavior
Implement a single explicit reset mechanism that clears all onboarding state when the wizard is closed or a new onboarding session begins.

## Scope
Frontend onboarding wizard state management.

## Acceptance criteria
- [ ] An explicit reset mechanism clears all onboarding state: step, max step, quick URL, URL detection status, project name, project ID, workspace path (back to default), tracker state, Git host, tracker project, tracker organization URL, PAT, PAT verification state, scope results, least-privilege acknowledgment, submission state, error state, discovered repositories, selected/configured repositories, and inspection/readiness results.
- [ ] The reset runs whenever the wizard is closed or a new onboarding session begins.
- [ ] Sensitive values (especially PATs) explicitly do not survive a closed wizard session.
- [ ] Unrelated modal behavior remains unchanged.

## Tests required
- [ ] Test filling wizard fields, advancing steps, and entering a PAT.
- [ ] Test closing the modal.
- [ ] Test reopening the modal.
- [ ] Verify it is a completely fresh session.
- [ ] Verify the PAT and all derived states are explicitly cleared.

## Dependencies/blockers
None.

## Important architectural constraints
This is a frontend defense-in-depth issue. Do not describe the current implementation as a confirmed state-leak bug, merely an implicit reset that needs to be explicit.
'
echo "Created 116"

