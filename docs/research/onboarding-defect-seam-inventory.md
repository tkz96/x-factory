# Onboarding defect & provider-seam inventory

- **Ticket:** tkz96/x-factory#124
- **Branch:** `research/onboarding-defect-seam-inventory` (worktree at `main` @ `0cc27f6`)
- **Method:** Every claim below was verified against the source at commit `0cc27f6` with file:line evidence. Nothing is listed on speculation.

Severity scale: **P0** = data loss or blocked/broken flow · **P1** = wrong or missing behavior · **P2** = smell / latent risk.

---

## Part A — Prioritized defect list

### Summary table

| ID | Sev | Defect | Evidence (file:line) |
|----|-----|--------|----------------------|
| S1 | P1 | Jira tracker config never persists — no `jira` branch in create payload, no Jira fields collected, no validation | `OnboardingWizardModal.tsx:1606-1639`, `1476-1485`, `369-414`; `src/trackers/index.ts:54-69` |
| S2 | P2 | Dead `gitHost` state — collected in Step 2, feeds only the Review display | `OnboardingWizardModal.tsx:1275`, `337-353`, `1100/1133`, `1819-1820`, `1547` |
| S3 | P1 | `DEFAULT_WORKSPACE_PATH` hardcoded to maintainer's home dir in shipped source | `OnboardingWizardModal.tsx:35`, `171` |
| S4 | P2 | Azure URL/remote parsing duplicated ×4 across 3 layers (readiness.ts is a near-verbatim copy of git-remote.ts) | `src/inspection/readiness.ts:147-203` vs `src/shared/git-remote.ts:1-80`; `src/discovery/azure.ts:20-79`; `src/frontend/lib/wizard-url.ts:20-56`; `src/shared/normalization.ts:11-45` |
| H1 | P0 | GitHub discovery input-shape mismatch — wizard sends `pat`/`project`, provider reads `token`/`repoOwner` → GitHub onboarding blocked or returns the wrong owner's repos | `OnboardingWizardModal.tsx:1546-1552`; `src/frontend/lib/api-client.ts:97-102`; `src/discovery/github.ts:70-74` |
| H2 | P1 | "Verify PAT Scopes" sends `organization`, server reads `orgUrl` → scope verification always fails for plain project names | `OnboardingWizardModal.tsx:1457-1461`; `src/http/projects-controller.ts:435-451`; `src/azure/scopes.ts:191-210` |
| H3 | P1 | Post-creation "Test Azure DevOps Scopes" (TrackerSection) sends only `projectId`, which the endpoint ignores → always fails | `src/frontend/components/projects/TrackerSection.tsx:37-39`; `src/http/projects-controller.ts:435-451` |
| H4 | P1 | PAT is collected and verified but never persisted — wizard never calls the tracker-credentials endpoint | `OnboardingWizardModal.tsx:1606-1639`; `src/http/projects-controller.ts:183-203`, `330-335`; `src/trackers/index.ts:27-31` |
| H5 | P2 | Jira discovery silently degrades to a local workspace scan, masking auth/config failures | `src/discovery/jira.ts:28`, `40-42`, `97-108` |
| H6 | P2 | GitHub discovery error path surfaces the raw provider response body to the UI | `src/discovery/github.ts:58` (contrast `src/discovery/azure.ts:206-246`) |
| H7 | P2 | Duplicate detection has no Jira identity branch — Jira duplicates go undetected client-side | `src/shared/project-identity.ts:91-103`; server only checks ID: `src/config.ts:136-148` |
| H8 | P2 | Dead connection-test endpoints with a misleading fake-OK for non-Azure providers | `src/http/projects-controller.ts:393-433`, `486-487`; no frontend callers |
| H9 | P2 | Stale repo paths if the workspace path is edited after discovery (repo configs never recomputed) | `OnboardingWizardModal.tsx:1510-1518`, `1559`; `src/frontend/lib/wizard-repositories.ts:88-103` |
| H10 | P2 | Worker fallback fabricates `issueTracker: { provider: "jira" }` for unresolvable projects (adjacent to onboarding scope) | `src/worker.ts:854-865` |

Total: **14 defects** (1 P0, 5 P1, 8 P2).


### Seeded findings — verification detail

#### S1 (P1) — Jira gap in `handleCompleteOnboard` — verified

The create-project payload builds `issueTracker.azure` and `issueTracker.github` branches only (`src/frontend/components/modals/OnboardingWizardModal.tsx:1612-1630`); there is no `jira` branch, so a Jira project is saved with `provider: "jira"` but `issueTracker.jira === undefined` and only the deprecated `projectId` field populated from `trackerProject` (`OnboardingWizardModal.tsx:1615`; deprecated marker in `src/shared/types.ts:106-107`).

The rest of the Jira path confirms the gap:

- Step 2 renders org URL / PAT fields **only** when `tracker === "azure"` (`OnboardingWizardModal.tsx:369-414`); Jira needs `host`, `email`, `token` (`src/trackers/index.ts:54-69` throws "Requires host, email, and API token") but the wizard never collects them.
- `canGoNextFromStep2` has branches for `azure` and `github` only (`OnboardingWizardModal.tsx:1476-1485`) — a Jira selection advances with every field empty.
- Result: ticket fetching for a wizard-created Jira project always throws `Jira issue tracker configuration is incomplete…` (`src/trackers/index.ts:65-69`).

**Fix direction:** add a `jira: { host, email, project }` branch to the payload plus Step 2 Jira fields and validation in `canGoNextFromStep2`.

#### S2 (P2) — Dead `gitHost` state — verified

`gitHost` is state at `OnboardingWizardModal.tsx:1275`, set from the Step 2 "Git Hosting Provider" select (`337-353`, options gitlab/bitbucket/local included), reset on modal open/close (`1336`, `1428`). Its **only** consumption is the Step 6 Review "Provider" display (`1100`, `1133`; passed at `1819-1820`). Discovery is keyed off the *tracker* selection instead (`runDiscovery` sends `provider: tracker`, `OnboardingWizardModal.tsx:1547`). Choosing "GitLab", "Bitbucket", or "Local Only" therefore changes nothing except a label on the review screen.

**Fix direction:** either drive discovery/local-scan from `gitHost` or remove the control and the state.

#### S3 (P1) — Hardcoded `DEFAULT_WORKSPACE_PATH` — verified

`export const DEFAULT_WORKSPACE_PATH = "/Users/talhazuberi/projects"` (`OnboardingWizardModal.tsx:35`) is the initial `workspacePath` state (`1273`) and the reset value (`1332-1333`); the Step 1 placeholder repeats the path (`171`). On any other machine the default points at a nonexistent directory, so local/Jira-fallback discovery fails with "Unable to read workspace directory…" (`src/discovery/local.ts:71-76`).

**Fix direction:** derive from `os.homedir()` via an API (or an env/config value), or default to empty with a required-input hint.

#### S4 (P2) — Azure URL/remote parsing duplicated ×4 — verified

Four independent implementations of Azure URL/remote parsing, in three layers:

1. `src/inspection/readiness.ts:147-203` — **near-verbatim local copy** of `matchAzureRemote`, `matchGitHubRemote`, `cleanGenericRemote`, `normalizeGitRemoteUrl` from `src/shared/git-remote.ts:1-80` (same regexes, same `azure:`/`github:` identity strings; readiness.ts even re-exports `normalizeGitRemoteUrl` at line 195, shadowing the shared one).
2. `src/shared/git-remote.ts:1-80` — the shared module itself.
3. `src/discovery/azure.ts:20-79` — `extractAzureDevOpsInfo` (dev.azure.com, ssh.dev.azure.com:v3, visualstudio.com, org/project forms).
4. `src/frontend/lib/wizard-url.ts:20-56` — `AZURE_REGEX` quick-URL parsing (dev.azure.com + visualstudio.com).

A fifth partial duplicate exists in `src/shared/normalization.ts:11-45` (`normalizeAzureOrganization` / `normalizeAzureProject` / `normalizeGitHubRepository` re-implement scheme/host/repo cleanup). Divergence is already visible: `wizard-url.ts:21` accepts `org.visualstudio.com` but not SSH remotes, while `git-remote.ts:3-14` handles SSH but not the bare `org/project` form — a URL accepted by one layer can be rejected by another.

**Fix direction:** one canonical Azure (and GitHub) URL/remote parser in `src/shared/`, consumed by discovery, inspection, and the wizard.

### Hunted findings — evidence

#### H1 (P0) — GitHub discovery input-shape mismatch

`runDiscovery` posts `{ provider, orgUrl, project, pat, workspacePath }` (`OnboardingWizardModal.tsx:1546-1552`; the client type at `src/frontend/lib/api-client.ts:97-102` cannot even express other fields). But `GitHubRepositoryDiscovery.listRepositories` reads **`input.token`** and **`input.repoOwner`** and ignores `project`/`pat` entirely (`src/discovery/github.ts:70-74`). Consequences:

- Without a global `GITHUB_TOKEN`, the unauthenticated call to `api.github.com/user/repos` returns 401 → "GitHub authentication failed. Check your GitHub Personal Access Token." (`github.ts:44-46`) → `discoveryError` set (`OnboardingWizardModal.tsx:1562-1565`) → Step 3 "Continue" is disabled (`519-524`) — **the GitHub onboarding flow is blocked**.
- With a global token, `owner` is still empty (`repoOwner` is never sent), so discovery lists the *authenticated user's* repos, not the `owner/repo` the user entered in Step 2.

Azure works only because the wizard's field names happen to match the Azure provider (`input.pat`, `input.orgUrl`, `input.project` — `src/discovery/azure.ts:99-133`).

**Fix direction:** send `token: trackerPat` and derive `repoOwner` from `trackerProject` (split on `/`), and extend the `api-client.discoverRepositories` payload type.

#### H2 (P1) — `organization` vs `orgUrl` field-name mismatch in PAT scope verification

`handleVerifyPat` calls `api.testAzureScopes({ organization: trackerOrgUrl, … })` (`OnboardingWizardModal.tsx:1457-1461`; client type at `src/frontend/lib/api-client.ts:246-253`). The server handler destructures `{ orgUrl, project, pat }` and ignores `organization` (`src/http/projects-controller.ts:435-451`). `testAzurePatScopes` then receives `orgUrl: undefined`; it can only recover an org by parsing `options.project` as an Azure URL (`src/azure/scopes.ts:191-192`), which fails for a plain project name like "Converso" (the bare form in `extractAzureDevOpsInfo` requires `org/project` — `src/discovery/azure.ts:64-76`). Result: **"Verify PAT Scopes" always returns "Organization URL and Project Name are required for scope validation"** (`scopes.ts:207-216`) for typical input. Ironically, the correctly-shaped endpoint `POST /api/projects/test-connection` does read `orgUrl` (`projects-controller.ts:397-424`) but has no frontend caller (see H8).

**Fix direction:** send `orgUrl` (or accept `organization` server-side); cover with a contract test against the real handler rather than a mocked fetch.

#### H3 (P1) — TrackerSection scope test can never succeed

`TrackerSection`'s "Test Azure DevOps Scopes" button posts only `{ projectId: project.id }` (`src/frontend/components/projects/TrackerSection.tsx:37-39`). `handleTestAzureScopes` reads none of that (`projects-controller.ts:435-451`) and never resolves the project's stored config/env, so `testAzurePatScopes` always returns the "Organization URL and Project Name are required" failure and the UI shows "Verification failed" (`TrackerSection.tsx:43-47`).

**Fix direction:** have the endpoint load org/project/PAT from `getProject` + `loadProjectEnv` when only `projectId` is supplied.

#### H4 (P1) — Verified PAT is never persisted

The wizard collects the PAT (state at `OnboardingWizardModal.tsx:1278`), verifies it, uses it for discovery — then the create payload contains **no secret** (`1606-1639`; asserted by design in `test/frontend-wizard-review.test.tsx:440-442`). The intended persistence path is `PUT /api/projects/:id/tracker/credentials` (`src/http/projects-controller.ts:183-203`, routed at `330-335`), but **no frontend code calls it** (grep across `src/frontend` finds no reference), and the wizard invokes no other secret-saving path. On submit the wizard only POSTs `/api/projects` (`1641-1645`) and closes, wiping the PAT from state (`1339`). Ticket fetching later resolves the PAT from project env, then `process.env.AZURE_DEVOPS_PAT` (`src/trackers/index.ts:27-31`); without the latter set globally, an Azure project that "verified green" during onboarding cannot fetch tickets.

**Fix direction:** after successful creation, call the tracker-credentials endpoint with the in-memory PAT (still never written into `projects.json`).



#### H5 (P2) — Jira discovery silently degrades to a local scan

The wizard sends Azure-shaped fields for every tracker (`OnboardingWizardModal.tsx:1546-1552`), while `JiraRepositoryDiscovery` reads `jiraHost`/`jiraEmail`/`jiraToken` (`src/discovery/jira.ts:52-62`) — none of which are ever sent. `hasJiraCredentials` is false, so it silently returns the local workspace scan (`jira.ts:97-108`); non-OK responses and fetch errors are swallowed to `null` (`jira.ts:28`, `40-42`). A user selecting Jira sees "N repositories discovered" that are actually local folders, and a bad Jira token produces no error at all.

**Fix direction:** distinguish "credentials incomplete" from "components empty", and surface API errors instead of masking them with the local fallback.

#### H6 (P2) — Raw provider response leaked in GitHub discovery errors

`throw new Error(\`GitHub API error (${res.status}): ${await res.text()}\`)` (`src/discovery/github.ts:58`) puts the raw response body (possibly HTML or an internal JSON blob) directly into `discoveryError`, which is rendered verbatim in Step 3 (`OnboardingWizardModal.tsx:483-489`). Azure has a sanitizing path (`sanitizeHttpError`, `src/discovery/azure.ts:206-246`); GitHub has none.

**Fix direction:** extract the sanitizer into a shared HTTP-error helper used by all discovery providers.

#### H7 (P2) — No Jira branch in duplicate detection

`checkExternalProviderMatch` only matches `azure` and `github` identities (`src/shared/project-identity.ts:91-103`); a Jira project with the same host+key as an existing one passes client-side duplicate detection (`OnboardingWizardModal.tsx:1573-1580`). The server enforces only ID collisions (`src/config.ts:136-148`).

**Fix direction:** add `matchesJiraIdentity` (host + project key) to `project-identity.ts`.

#### H8 (P2) — Dead/misleading connection-test endpoints

`POST /api/projects/test-connection` (aliases `test-tracker`) at `src/http/projects-controller.ts:393-433` / `486-487` has **no frontend caller** (grep over `src/frontend` finds none; `api-client.ts` has no such method). Its non-Azure branch returns a fake success — `{ ok: true, message: "Connection parameters accepted." }` (`425-429`) — without contacting GitHub or Jira. The per-project `…/tracker/test` route (`336-338`) is likewise uncalled. Meanwhile the endpoint the UI *does* call is the broken one (H2/H3).

**Fix direction:** delete the dead endpoints or wire the UI to the correctly-shaped one; never return `ok: true` without a probe.

#### H9 (P2) — Stale repository paths after editing the workspace root

Repo configs are computed once from `workspacePath` at discovery time (`OnboardingWizardModal.tsx:1559`) and re-initialized only when empty (`1510-1518`); `getEffectiveRepoConfig` always prefers the stored config (`src/frontend/lib/wizard-repositories.ts:88-103`). The stepper lets the user jump back to Step 1 (any `s.num <= maxStep`, `OnboardingWizardModal.tsx:1700-1710`), and `onWorkspacePathChange={setWorkspacePath}` (`1791`) resets nothing. Result: edit the workspace root after discovery and the Step 4/6 paths — and the paths persisted at creation (`1631-1638`, `repositoryPath` at `1601-1603`) — still point at the old root.

**Fix direction:** recompute unedited repo paths when `workspacePath` changes (or invalidate discovery state on Step 1 edits).

#### H10 (P2) — Fabricated Jira provider in worker fallback (adjacent)

When a run's project cannot be loaded, the worker synthesizes a project whose `issueTracker` is hardcoded to `{ provider: "jira" }` with no config (`src/worker.ts:854-865`) — an arbitrary provider default that will fail any tracker use and mislabels the project.

**Fix direction:** omit the tracker (and let consumers report "none") instead of defaulting to Jira.

---

## Part B — Provider-seam inventory

Locations where provider-specific logic lives **outside** the provider modules (`src/trackers/*`, `src/discovery/*`). "Owner" = the provider the logic belongs to.

| # | Location (file:line) | What it does | Provider owner |
|---|----------------------|--------------|----------------|
| 1 | `src/frontend/lib/wizard-url.ts:20-56` | Azure/GitHub quick-URL regex parsing → org/project/owner/repo | azure, github |
| 2 | `src/frontend/lib/wizard-url.ts:58-79` | Role-inference keyword table (repo taxonomy, provider-adjacent) | — (generic) |
| 3 | `src/shared/git-remote.ts:1-80` | `matchAzureRemote` / `matchGitHubRemote` / `cleanGenericRemote` remote normalization; emits `azure:`/`github:` identity strings | azure, github |
| 4 | `src/inspection/readiness.ts:147-203` | Near-verbatim local copy of seam #3 (incl. re-exported `normalizeGitRemoteUrl` at 195) | azure, github |
| 5 | `src/shared/normalization.ts:11-45` | `normalizeAzureOrganization` / `normalizeAzureProject` / `normalizeGitHubRepository` | azure, github |
| 6 | `src/shared/project-identity.ts:35-105` | Provider-keyed duplicate-identity matchers (`matchesAzureIdentity`, `matchesGitHubIdentity`; jira missing) | azure, github |
| 7 | `src/frontend/components/modals/OnboardingWizardModal.tsx:1424-1443` | Quick-URL auto-populate branches per provider | azure, github |
| 8 | `src/frontend/components/modals/OnboardingWizardModal.tsx:369-414` | Step 2 renders org-URL/PAT fields and the Azure scope card only for Azure | azure |
| 9 | `src/frontend/components/modals/OnboardingWizardModal.tsx:1476-1485` | `canGoNextFromStep2` per-provider validation branches | azure, github (jira missing) |
| 10 | `src/frontend/components/modals/OnboardingWizardModal.tsx:1606-1639` | Create-project payload per-provider branches (`azure:`/`github:`; jira missing) | azure, github (jira missing) |
| 11 | `src/frontend/components/modals/OnboardingWizardModal.tsx:981-988` | `formatAzureOrg` display helper | azure |
| 12 | `src/frontend/components/modals/OnboardingWizardModal.tsx:1043-1056` | Duplicate-warning banner renders azure/github identity blocks | azure, github |
| 13 | `src/frontend/lib/api-client.ts:97-102` | Discovery payload type shaped for Azure fields only (`orgUrl`/`project`/`pat`) | azure-centric |
| 14 | `src/frontend/lib/api-client.ts:246-269` | `testAzureScopes` client method (Azure-only verification surface) | azure |
| 15 | `src/http/projects-controller.ts:393-433` | `handleTestConnection` — Azure probe + fake-OK for other providers | azure (+ stubs) |
| 16 | `src/http/projects-controller.ts:435-452` | `handleTestAzureScopes` — Azure-only endpoint, no provider dispatch | azure |
| 17 | `src/http/projects-tracker-helpers.ts:28-30` | Provider fallback chain `tracker.provider || connectionId || "github"` | all (default github) |
| 18 | `src/http/projects-tracker-helpers.ts:36-51` | Provider → secret env-key mapping (`AZURE_PAT`/`JIRA_TOKEN`/`GITHUB_TOKEN`) | all |
| 19 | `src/http/projects-tracker-helpers.ts:73-103` | Credential alias mapping (`pat`/`token`/`secret` → per-provider env keys) | all |
| 20 | `src/http/projects-tracker-helpers.ts:110-194` | Per-provider connection tests (Jira basic-auth probe, GitHub ticket fetch) living in the HTTP layer | jira, github |
| 21 | `src/http/projects-tracker-helpers.ts:238-244, 264-273` | Migration plan per-provider config/secrets branches | all |
| 22 | `src/executors/deliver.ts:40-75` | Azure-specific PR creation/recovery branch inside the deliver executor | azure |
| 23 | `src/config-schema.ts:21-45, 394-490` | Provider enum + `parseAzureTrackerConfig` / `parseJiraTrackerConfig` / `parseGitHubTrackerConfig` and provider defaulting (`457-466`) | all |
| 24 | `src/frontend/views/SettingsView.tsx:249-257` | Provider-conditional target rendering per project | all |
| 25 | `src/frontend/components/projects/TrackerSection.tsx:75-109` | Provider-conditional config display (azure org/project, jira host, github repo) | all |
| 26 | `src/frontend/components/projects/TrackerSection.tsx:112-141` | Azure-only "Test Scopes" button | azure |
| 27 | `src/worker.ts:854-865` | Fallback project fabricates `provider: "jira"` | jira |
| 28 | `src/azure/*` (`auth.ts`, `scopes.ts`, `connection.ts`) | Azure-specific auth/scope/connection modules living outside `src/trackers` / `src/discovery`; `src/azure/scopes.ts:2` reaches into `src/discovery/azure.ts` for URL parsing | azure |

**Total: 27 provider seams** (rows 1 and 3-28; row 2 is generic role inference, listed only for completeness).

Structural observations:

- The seam with the highest churn risk is **remote/URL parsing**: four implementations (seams 1, 3, 4, 5) that already disagree on accepted URL forms (see S4).
- The **Jira provider is systematically under-wired** at every seam: no payload branch (S1), no validation branch (seams 9/10), no duplicate-identity branch (seam 6), silently degrading discovery (H5), and an arbitrary worker default (seam 27).
- The **Azure provider leaks the most logic** outside its modules: a dedicated module directory (`src/azure/*`) outside the provider registries, two HTTP endpoints (seams 15-16), a dedicated client method (seam 14), a PR branch in the deliver executor (seam 22), and wizard UI conditionals (seams 7-12).

---

## Notes for follow-up tickets

1. H1 + S1 together mean **only the Azure path of the wizard is functional end-to-end**; GitHub is blocked at Step 3 and Jira produces a project that cannot fetch tickets.
2. H2/H3/H4 share one root cause: the wizard ↔ server tracker/scope contract has never been tested against the real handler (existing wizard tests mock `fetch`, e.g. `test/frontend-wizard-discovery.test.tsx:50-52`, so field-name mismatches pass).
3. S4 + seams 1/3/4/5 should be fixed as a single refactor (one shared parser) before a third provider lands.

