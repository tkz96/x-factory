#!/bin/bash
set -e

ISSUE1=$(gh issue create --title "Backend: POST /api/projects must reject duplicate project IDs" --body '## What to build
The project creation endpoint `POST /api/projects` currently uses `saveProject()`, which silently updates/upserts an existing project if the ID matches. This can lead to catastrophic data loss during onboarding if a user submits a duplicate ID.
We need a create-only path (`createProject()`) that strictly throws a duplicate-error (mapped to a `409 Conflict` HTTP response) if the project ID already exists. 
`saveProject()` must remain unchanged to preserve existing update and migration behaviors.

## Acceptance criteria
- [ ] A new `createProject` function exists in the backend configuration layer that fails if the ID exists.
- [ ] `POST /api/projects` uses `createProject` and returns `409 Conflict` on duplicates.
- [ ] `saveProject` is unchanged and existing updates continue working.
- [ ] Tests verify that a duplicate `POST` yields a 409 without overwriting data.

## Blocked by
- None (can start immediately).')
echo "Issue 1: $ISSUE1"

ISSUE2=$(gh issue create --title "Wizard: Connect Step 3 to repository discovery API" --body '## What to build
Step 3 of the onboarding wizard currently shows a static placeholder and does not call the backend discovery API. We need to wire this step up to call `POST /api/projects/discover-repositories` using the existing API client pattern. It must properly capture all discovered repositories, preserving their IDs, names, remote URLs, and default branches.

## Acceptance criteria
- [ ] Step 3 invokes `POST /api/projects/discover-repositories` when entered.
- [ ] Loading, empty, and error states are displayed appropriately.
- [ ] The discovered list of repositories and their metadata are preserved in the wizard'"'"'s state.
- [ ] Passing the Azure `Converso` test case correctly discovers and preserves all 14 repositories in the wizard.

## Blocked by
- None (can start immediately).')
echo "Issue 2: $ISSUE2"

ISSUE3=$(gh issue create --title "Wizard: Prevent onboarding of duplicate projects via UI" --body "## What to build
The frontend onboarding wizard has no duplicate-project detection. If a user pastes a URL that resolves to an already-onboarded project, the wizard proceeds normally, leading to a late 409 error (once backend protection is in place). 
We must query existing projects using \`useProjects()\` to detect collisions using the strongest identity signals (e.g. project ID, normalized provider URL, owner/repo). If a duplicate is found, the user should see a clear message and a path to inspect the existing project instead of creating a conflicting one.

## Acceptance criteria
- [ ] Wizard detects duplicate projects based on URL, ID, or repo combinations before submission.
- [ ] A clear message is shown to the user when a duplicate is found.
- [ ] The flow provides a link/path to inspect the existing project.
- [ ] False positives are minimized.

## Blocked by
- $ISSUE1")
echo "Issue 3: $ISSUE3"

ISSUE4=$(gh issue create --title "Wizard: Display and configure discovered repositories in Step 4" --body "## What to build
Step 4 of the onboarding wizard currently shows a static placeholder configuration for a single repository. It must be replaced with an interactive list of the repositories discovered in Step 3. Users should be able to select multiple repositories, choose exactly one primary repository (where required), override local paths independently, and assign roles (using \`inferRepoRole()\` as a default where appropriate).

## Acceptance criteria
- [ ] Discovered repositories from Step 3 are displayed in Step 4.
- [ ] Users can select/deselect multiple repositories.
- [ ] Users can choose exactly one primary repository if domain model requires it.
- [ ] Users can configure independent local paths.
- [ ] Discovered remote URLs and default branches are preserved.
- [ ] Existing \`inferRepoRole()\` logic is used to set initial roles.
- [ ] Invalid or ambiguous configuration is prevented.

## Blocked by
- $ISSUE2")
echo "Issue 4: $ISSUE4"

ISSUE5=$(gh issue create --title "Wizard: Call repository inspection endpoint for configured repos" --body "## What to build
The wizard needs to verify that the selected repositories are ready on disk. Step 5 must call the existing \`POST /api/projects/inspect-repository\` endpoint for each repository selected in Step 4. The UI should display per-repository readiness (missing directory, non-Git directory, ready, or inspection failure) and block the final onboarding step if they are not all inspected and ready.

## Acceptance criteria
- [ ] Step 5 calls \`inspect-repository\` for each selected repository.
- [ ] The UI clearly distinguishes between missing directories, non-Git directories, ready repositories, and API failures.
- [ ] The wizard prevents moving to the final step if repositories are not ready or un-inspected.

## Blocked by
- $ISSUE4")
echo "Issue 5: $ISSUE5"

ISSUE6=$(gh issue create --title "Wizard: Display accurate review and send multi-repo payload" --body "## What to build
The final \"Review\" step (Step 6) currently reflects static data and sends a hardcoded single-repository payload to the backend. It must be updated to display the actual selected repositories (count, names, roles, primary, paths, branches, connections). The final \`POST /api/projects\` payload must be constructed from this full configuration, resulting in a complete multi-repository project.

## Acceptance criteria
- [ ] The Review step correctly summarizes the selected repositories (count, names, roles, primary, paths, branches).
- [ ] The final API payload submits all configured repositories.
- [ ] The hardcoded single-repository creation payload is removed.
- [ ] PATs and other sensitive secrets are not submitted in the project creation payload.
- [ ] Existing tracker configuration behavior is preserved.
- [ ] A successful POST creates the complete multi-repo project.

## Blocked by
- $ISSUE1
- $ISSUE5")
echo "Issue 6: $ISSUE6"

ISSUE7=$(gh issue create --title "Wizard: Harden Azure discovery errors and explicitly reset state" --body "## What to build
When Azure authentication fails (e.g. invalid PAT), Azure returns an HTML login page instead of a JSON error, resulting in an unhelpful \"JSON parse error\" in the UI. We need to handle this failure case cleanly in the backend. 
Additionally, for defense-in-depth on the frontend, the wizard must explicitly reset its state (including sensitive fields like PATs) when closed, rather than relying solely on React component unmounting.

## Acceptance criteria
- [ ] Azure discovery correctly catches HTML responses (302/401/403) and surfaces a clear authentication error.
- [ ] The wizard handles discovery failure cases gracefully.
- [ ] An explicit state reset mechanism is added to the wizard for defense in depth.
- [ ] Sensitive state (like PATs) is explicitly cleared when the wizard is closed/reset.

## Blocked by
- $ISSUE2")
echo "Issue 7: $ISSUE7"
