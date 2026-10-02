# Provider capability matrix: GitHub, Azure DevOps, Jira Cloud

Research for issue `tkz96/x-factory#125`.
Grounds a future provider contract in what the three providers' REST APIs **verifiably offer today**. Every claim cites either an official documentation URL or a repo file:line at commit `0cc27f6` (branch `research/provider-capability-matrix`). No capability is asserted beyond what is documented or already implemented.

---

## 1. Existing-code baseline

What the current integration layer already implements per provider. This is the floor the provider contract must at least describe.

### Shared tracker layer

| Concern | Implementation | Evidence |
| --- | --- | --- |
| Provider union | `"github" \| "jira" \| "azure"` | `src/trackers/types.ts:7` |
| Workflow label convention | `REQUIRED_WORKFLOW_LABEL = "agentic-workflow"`, case-insensitive comparison | `src/trackers/types.ts:5`, `src/trackers/types.ts:33-39` |
| Normalized ticket shape | `TrackerTicket` (labels, url, provider, updatedAt) | `src/trackers/types.ts:9-14` |
| Pluggable registry + unified resolver | credential/config resolution per provider from project settings + project `.env` | `src/trackers/index.ts:111-150` |
| Zod response schemas per provider | Azure WIQL + work-item batch, GitHub issue list (REST + gh CLI), Jira search | `src/trackers/schemas.ts:9-91` |

### GitHub

- Issue fetching via REST `GET /repos/{repo}/issues?labels=<label>&state=open&per_page=50` with `Bearer` token, plus a `gh` CLI fallback (`gh issue list --json ...`) — `src/trackers/github.ts:56-96`.
- Pull-request filtering (REST issues include PRs) — `src/trackers/github.ts:76`.
- Repo auto-detection from the git `origin` remote — `src/trackers/github.ts:12-20`.
- Repository discovery: `GET /orgs/{owner}/repos` with `GET /users/{owner}/repos` fallback on 404, or `GET /user/repos?affiliation=...` when no owner is given; 401/403/404 mapped to friendly errors — `src/discovery/github.ts:35-57`.
- Existing-PR lookup via `gh pr view` (CLI only; no REST PR-creation or status code exists for GitHub) — `src/github.ts:24-47`.
- **No credential verification endpoint call** (no `GET /user`), **no scope checks** (no `X-OAuth-Scopes` header inspection), **no rate-limit handling**.

### Azure DevOps

- Auth header resolution: PAT formatted as `Basic base64(":"+PAT)`; JWT-shaped tokens (starting `eyJ`) sent as `Bearer`; fallback to `az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` (the Azure DevOps resource ID) for an active Azure CLI session — `src/azure/auth.ts:6-12`, `src/azure/auth.ts:24-51`.
- Work-item fetching: WIQL `POST {org}/{project}/_apis/wit/wiql?api-version=7.1` filtering on `[System.Tags] CONTAINS '<label>'` and non-closed states, then a batch `GET .../_apis/wit/workitems?ids=...` — `src/trackers/azure.ts:18-40`, `src/trackers/azure.ts:112`.
- Tags parsed from the semicolon-delimited `System.Tags` field as the label equivalent — `src/trackers/azure.ts:66-69`.
- Live PAT scope diagnostics (behavioral probes — the most developed least-privilege checking in the repo): Work Items Read via WIQL probe, Code Read via repositories list, Code Status via commit-statuses GET, Work Items Write detection via a `PATCH /_apis/wit/workitems/-1` probe (404 = write authorized), Code Full detection via the recycle-bin API. Required set: Work Items (Read) + Code (Read) + Code (Status); over-privilege warnings for Work Items (Write) and Code (Full) — `src/azure/scopes.ts:29-55`, `:57-92`, `:94-118`, `:120-149`, `:151-173`, `:277-309`.
- Connection test / repo discovery: `GET {org}/{project}/_apis/git/repositories?api-version=7.1` — `src/azure/connection.ts:74-119`, `src/discovery/azure.ts:248-309`. 401/403 → auth failure, 404 → project not found, HTML sign-in / 203 responses treated as auth failure, JSON `message` extracted from error bodies — `src/discovery/azure.ts:261-291`, `:206-246`.
- Org/project/repo URL parsing for `dev.azure.com`, `ssh.dev.azure.com:v3`, `*.visualstudio.com`, and bare `org/project` forms — `src/discovery/azure.ts:20-79`.
- PR creation and existing-PR lookup via `POST/GET .../_apis/git/repositories/{repo}/pullrequests` (create only; never merge/close — safety invariant) — `src/azure/pr.ts:2-3`, `:57-133`, `:146-221`.
- Commit-status publishing via `POST .../commits/{commit}/statuses` with `context.genre`/`context.name` — `src/azure/status.ts:31-100`.

### Jira Cloud

- Issue fetching: Basic auth `base64(email:api_token)` and JQL `labels = "<label>" AND project = ... AND statusCategory != Done` against `GET /rest/api/3/search?jql=...&maxResults=50` — `src/trackers/jira.ts:20-31`. (See §4: this endpoint is documented as "Currently being removed".)
- ADF description parsing to plain text — `src/trackers/jira-adf.ts`, used at `src/trackers/jira.ts:49-51`.
- Repository "discovery" is a workaround, not a repo API: fetch project components via `GET /rest/api/3/project/{project}/components`, else fall back to a local workspace directory scan — `src/discovery/jira.ts:11-43`, `:91-113`.
- **No credential verification endpoint call** (no `GET /rest/api/3/myself` or `/mypermissions`), **no scope/permission checks**, **no rate-limit handling**, **no PR/status integration** (Jira is issue-tracker-only in the codebase).

---

## 2. Provider × capability matrix

| Capability | GitHub | Azure DevOps | Jira Cloud |
| --- | --- | --- | --- |
| **Credential types** | Fine-grained PAT, classic PAT, GitHub App token, OAuth token, `GITHUB_TOKEN` in Actions; `gh` CLI session | Organization-scoped PAT (Basic), Entra/OAuth Bearer (CLI or service principal); `az` CLI session | Atlassian API token + account email (Basic auth); OAuth 2.0 (3LO) / Forge for apps |
| **Credential verification endpoint** | `GET https://api.github.com/user` (200 = valid; 401 = bad credentials) | `GET {orgUrl}/_apis/projects?api-version=7.1` (200 = token+org valid; 401/403 = bad) or `.../{project}/_apis/git/repositories`; today implemented via repos list | `GET https://{site}.atlassian.net/rest/api/3/myself` (200 + user payload = valid; 401 = bad). Not implemented in code |
| **Token scopes** | Classic PATs/OAuth tokens carry scopes, readable via `X-OAuth-Scopes` response header; fine-grained PATs use per-repo permissions (no scope header; `X-Accepted-GitHub-Permissions` on 403 aids diagnosis) | PATs carry a fixed scope set chosen at creation (e.g. `vso.work`, `vso.code`, `vso.code_status`); **no introspection endpoint** — only behavioral probes (implemented in `src/azure/scopes.ts`) | **API tokens have no scopes** — full user permissions; nearest check is permission introspection via `GET /rest/api/3/mypermissions` |
| **Repository discovery / listing** | Yes: `GET /user/repos`, `GET /orgs/{org}/repos`, `GET /users/{username}/repos` | Yes: `GET {org}/{project}/_apis/git/repositories` | **None.** No repository/git resource in the Jira REST API; DVCS repos come from marketplace integrations. Code substitutes project components + local workspace scan |
| **Issue/board key concepts** | `owner/repo`; issues keyed by number; labels are first-class strings | `organization/project`; work items keyed by numeric ID; `System.Tags` (semicolon-delimited) as label equivalent | `{site}.atlassian.net` + project key (e.g. `ABC`); issues keyed by `KEY-123`; `labels` field on issues |
| **Fetching labeled/recent issues** | `GET /repos/{owner}/{repo}/issues?labels=...&state=open`; PRs included and must be filtered | WIQL `POST _apis/wit/wiql` + work-item batch by IDs | JQL `GET/POST /rest/api/3/search` (legacy GET documented as "Currently being removed"; successor `/rest/api/3/search/jql`) |
| **Rate-limit signaling** | **403 or 429**; `x-ratelimit-limit/remaining/reset/used`, `retry-after` on secondary limits; `x-ratelimit-remaining: 0` is the disambiguator | **429** with `TF400733` message; `Retry-After` + `X-RateLimit-*` (TSTU-based) headers; requests may also be silently delayed | **429** with `Retry-After`; token-based traffic governed by burst limits; app traffic by points-based quotas |
| **Error response shape** | JSON `{ "message": ..., "documentation_url": ..., "errors": [...] }`; 401 Bad credentials, 403 forbidden/rate-limited, 404 not found, 422 validation | Usually JSON `{ "message": ... }`, **but HTML sign-in pages (even on 2xx/203) for unauthenticated browser-style redirects** — code already sanitizes this | JSON "Error Collection" `{ "errorMessages": [...], "errors": { field: msg } }`; standard 401/403/404; CAPTCHA lockout signaled by `X-Seraph-LoginReason: AUTHENTICATION_DENIED` header |

---

## 3. Per-provider detail

### 3.1 GitHub

**Credentials & auth.** GitHub supports two PAT types — fine-grained (per-repository, per-permission, recommended) and classic (scope-based) — plus GitHub App tokens, OAuth tokens, and `gh` CLI sessions. "GitHub currently supports two types of personal access tokens: fine-grained personal access tokens and personal access tokens (classic)." A token never grants capabilities beyond what its owner already has. ([Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)). The codebase sends `Authorization: Bearer` tokens (`src/trackers/github.ts:59`) with a `gh` CLI fallback (`src/trackers/github.ts:81-96`); the REST API docs document the same `Bearer` header and `gh api` patterns ([Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api)).

**Credential verification.** `GET /user` ("Get the authenticated user") returns the user resource for the token holder and is the canonical token check: https://docs.github.com/en/rest/users/users#get-the-authenticated-user. A wrong/expired token yields **401** with a `{"message":"Bad credentials",...}` JSON body (error shape documented at https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api). Not yet implemented in code — a gap for the provider contract.

**Scopes / least privilege.** Classic PAT/OAuth scopes (`repo`, `read:org`, ...) are reported on every response: "Check headers to see what OAuth scopes you have, and what the API action accepts: `X-OAuth-Scopes: repo, user` / `X-Accepted-OAuth-Scopes: ...`" ([Scopes for OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)). GitHub scope checking is therefore **header introspection** — no probing needed — a mirror image of Azure's probe-only model. Fine-grained PATs do not emit `X-OAuth-Scopes`; 403 responses instead carry `X-Accepted-GitHub-Permissions` naming the permissions the endpoint requires ([Troubleshooting the REST API](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)).

**Repository discovery.** `GET /user/repos` (affiliation/visibility filters), `GET /orgs/{org}/repos`, `GET /users/{username}/repos` — https://docs.github.com/en/rest/repos/repos. Already implemented with an org→user 404 fallback (`src/discovery/github.ts:35-45`).

**Issue/board basics.** `GET /repos/{owner}/{repo}/issues` supports `labels`, `state`, `per_page` filters; the REST API considers every pull request an issue, which is why the code filters `pull_request` (`src/trackers/github.ts:76`) — https://docs.github.com/en/rest/issues/issues. A dedicated "List issues assigned to the authenticated user" endpoint also exists. Labels are first-class repo-scoped strings — a direct equivalent of the `agentic-workflow` convention (`src/trackers/types.ts:5`).

**Rate limits.** "If you exceed your primary rate limit, you will receive a **403 or 429** response, and the `x-ratelimit-remaining` header will be 0. ... If you exceed a secondary rate limit, you will receive a **403 or 429** response ... If the `retry-after` response header is present, you should not retry your request until after that many seconds" ([Rate limits for the REST API](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)). The `x-ratelimit-*` header family (`limit`, `remaining`, `reset`, `used`, `resource`) is documented as the authoritative state. Contract consequence: **403 alone is ambiguous** (rate limit vs permission) and must be disambiguated via `x-ratelimit-remaining`, not status code.

**Error shapes.** JSON body with `message` and `documentation_url`; validation failures are **422** with an `errors` array using `missing` / `missing_field` / `invalid` / `already_exists` / `unprocessable` / `custom` codes; a `User-Agent` header is required or the request is rejected. ([Troubleshooting the REST API](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api))

### 3.2 Azure DevOps

**Credentials & auth.** "A personal access token (PAT) is an alternative password for Azure DevOps authentication. A PAT identifies you and determines the resources and operations available to you." PATs are provisioned under user settings → Personal access tokens, with organization scoping, expiration, and explicit scope selection; **global (all-organization) PATs stop working December 1, 2026**, so the contract should assume organization-scoped PATs. PATs work with most — not all — REST APIs: "Some APIs, including the Organizations, Profiles, and PAT Lifecycle Management APIs, require Microsoft Entra tokens." Microsoft recommends Entra tokens, managed identities, or service principals over PATs where available. ([Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)) The code sends PATs as `Basic base64(":"+PAT)` and Entra/CLI tokens as `Bearer` (`src/azure/auth.ts:6-12`), with the `az` CLI bearer fallback using the Azure DevOps resource ID `499b84ac-1321-427f-aa17-267ca6975798` (`src/azure/auth.ts:30-43`).

**Credential verification.** `GET {orgUrl}/_apis/projects?api-version=7.1` — "Get all projects in the organization that the authenticated user has access to" ([Projects - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1)). Alternatively `GET {orgUrl}/{project}/_apis/git/repositories?api-version=7.1` ("Retrieve git repositories", [Repositories - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/list?view=azure-devops-rest-7.1)), which is what `testAzureConnection` uses today (`src/azure/connection.ts:100-101`). Note the conflation: the repos-list check requires `vso.code`, so it verifies token validity **and** Code (Read) at once. A pure whoami-style check that does not need Code access would be `_apis/projects` (scopes `vso.project` / `vso.profile`).

**Scopes / least privilege.** PAT scopes are fixed at creation and there is **no documented scope-introspection endpoint**. The scope catalog is documented at [OAuth scopes](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops) (the same definitions apply to PATs): `vso.work` — "Grants the ability to read work items, queries, boards, area and iterations paths ... Also grants the ability to execute queries"; `vso.work_write` (read and write); `vso.code` — "Grants the ability to read source code and metadata about commits, changesets, branches, and other version control artifacts"; `vso.code_status` — "Grants the ability to read and write commit and pull request status" (also listed on the statuses endpoint, [Statuses - Create](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/statuses/create?view=azure-devops-rest-7.1)); `vso.code_full`; `user_impersonation` — "Grants full access to Visual Studio Team Services REST APIs. Request or consent this scope with caution." Because scopes cannot be read, the repo implements **behavioral probing** (`src/azure/scopes.ts`): a WIQL probe for Work Items (Read), the repos list for Code (Read), a commit-statuses GET for Code (Status), a `PATCH _apis/wit/workitems/-1` probe whose 404 means write authorization passed, and the recycle-bin API as a Code (Full) detector. This is the pattern to generalize: **verification = probe + classify 200/401/403/404**.

**Repository discovery.** `GET {org}/{project}/_apis/git/repositories?api-version=7.1` returns `{count, value: [{id, name, defaultBranch, remoteUrl, webUrl, ...}]}` ([Repositories - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/list?view=azure-devops-rest-7.1)). Implemented and schema-validated (`src/discovery/schemas.ts:10-27`, `src/discovery/azure.ts:248-309`).

**Issue/board basics.** Org → project → work item. Work items are fetched via WIQL (`POST {org}/{project}/_apis/wit/wiql?api-version=7.1`), which returns work-item IDs for a `SELECT [System.Id] FROM WorkItems WHERE ...` query, followed by a batch `GET _apis/wit/workitems?ids=...` — exactly the flow in `src/trackers/azure.ts:18-40`, `:112` (WIQL syntax reference: https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops). The `agentic-workflow` label maps to `System.Tags` with `CONTAINS` matching (`src/trackers/azure.ts:20`); tags are semicolon-delimited (`src/trackers/azure.ts:66-69`).

**Rate limits.** Azure DevOps signals throttling with **HTTP 429** plus a `TF400733` message ("The request has been canceled: Request was blocked due to exceeding usage of resource ..."), and returns `Retry-After` (RFC 6585) plus `X-RateLimit-*` headers measured in Azure DevOps throughput units (TSTUs): `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `X-RateLimit-Delay`, `X-RateLimit-Cost`. Requests may also be **silently delayed** (milliseconds up to 30 s) before any 429 is issued. No fixed request-count quota is published — limits are consumption-based. ([Rate and usage limits](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits?view=azure-devops))

**Error shapes.** API errors are usually JSON `{message: ...}` and the code extracts `data.message` with a length cap (`src/discovery/azure.ts:223-234`). The critical Azure-specific hazard: **unauthenticated or misrouted requests can return HTML sign-in pages, including on 2xx/203 status**, which is why discovery treats `203`, HTML content-type, or redirects to `login`/`signin` as authentication failures (`src/discovery/azure.ts:281-291`). 401/403 → auth error; 404 → project not found (`src/discovery/azure.ts:261-270`).

### 3.3 Jira Cloud

**Credentials & auth.** "This page shows you how REST clients can authenticate themselves using basic authentication with an Atlassian account email address and API token. Authentication using passwords has been deprecated." The header is `Authorization: Basic base64(email:api_token)`; API tokens are generated per Atlassian account, are individually revocable, and work even when the organization enforces 2FA/SAML. The same restrictions apply as in the web UI: "if you log in and don't have permission to view something in Jira, you won't be able to view it using the Jira REST API either." The more secure alternative for distributable integrations is OAuth 2.0 (3LO) or Forge. ([Basic auth for REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)) This is exactly the scheme implemented in `src/trackers/jira.ts:23-25` and `src/discovery/jira.ts:18`.

**Credential verification.** `GET /rest/api/3/myself` — "Returns details for the current user. Permissions required: Permission to access Jira." Response codes: 200 OK (user payload with `accountId`, `emailAddress`, `timeZone`) and **401 Unauthorized** ([REST API v3 — Myself](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/)). A lower-frills alternative is `GET /rest/api/3/mypermissions` — "Returns a list of permissions indicating which permissions the user has", filterable by `projectKey`/`projectId` and a `permissions` parameter ([REST API v3 — Permissions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/#api-rest-api-3-mypermissions-get)). **Neither is called by the current code** — verification is implicit in the search call failing.

**Scopes / least privilege.** **API tokens have no scope model** — a token acts with the full permission set of its owning user in that site. The only introspection available is *permission*-level, not *token*-level: `/rest/api/3/mypermissions` for the current user's global/project/issue permissions, plus `POST /rest/api/3/permissions/check` and `POST /rest/api/3/permissions/project` for bulk checks ([REST API v3 — Permissions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/)). OAuth 2.0 (3LO) and Forge apps, by contrast, do carry classic/granular scopes such as `read:jira-work`, `read:jira-user` ([REST API v3 — Myself](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/)). Least privilege in X-Factory's PAT/basic-auth model can therefore only be *advised* (use a dedicated low-privilege account), not *verified*.

**Repository discovery — capability gap.** The Jira Cloud REST API v3 has **no repository or git resource at all**. The complete resource-group index of the REST API (Announcement banner, Audit records, ... Projects, ... Webhooks, Workflows) contains nothing for source repositories ([REST API v3 — About](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)). Repository linkage in Jira is provided by DVCS integrations (GitHub for Jira, Bitbucket, GitLab apps), which are UI/admin-managed, not exposed as a Jira REST capability for listing connected repositories. The existing code papers over this with project **components** (`GET /rest/api/3/project/{project}/components`) and a local-workspace scan fallback (`src/discovery/jira.ts:11-43`, `:91-113`). For the provider contract, `listRepositories` for Jira must be an **optional** capability with a documented degraded mode (components / local workspace / manual remote URL).

**Issue/board basics.** The addressing unit is the site (`{site}.atlassian.net`) plus a project key; issues are `KEY-123`. Search uses JQL. **Important finding:** the endpoint the code calls — `GET /rest/api/3/search` — is listed as "**Currently being removed.** Search for issues using JQL (GET)", alongside the POST variant, and is superseded by "Search for issues using JQL enhanced search" at `GET/POST /rest/api/3/search/jql` ([REST API v3 — Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)). `src/trackers/jira.ts:21` uses the legacy GET form — a migration item. Jira issues carry a native `labels` string array, a direct equivalent of GitHub labels and Azure tags (`src/trackers/jira.ts:53`).

**Rate limits.** "When any limit is exceeded, Jira returns an HTTP **429 Too Many Requests** response. Your app should handle this gracefully by respecting the **Retry-After** header and implementing appropriate backoff strategies." Three independent systems: points-based hourly quota (apps; REST exposes usage via `X-RateLimit-*` headers), per-second burst limits, and per-issue write limits. Crucially for X-Factory's token-based model: "API token-based traffic is not affected by this change, and will continue to be governed by existing burst rate limits." ([Rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/))

**Error shapes.** "The Jira Cloud platform REST API uses the standard HTTP status codes. Operations that return an error status code may also return a response body containing details of the error or errors", with the documented **Error Collection** schema: `{ "errorMessages": string[], "errors": { <field>: string }, "status": int }` ([REST API v3 — About](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)). An extra Jira-specific signal: after repeated failed logins a **CAPTCHA** is triggered and REST authentication fails with an `X-Seraph-LoginReason: AUTHENTICATION_DENIED` response header until cleared ([Basic auth for REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)).

---

## 4. Capability gaps (must be *optional* in the provider contract)

1. **Jira has no repository discovery API.** No git/repository resource exists in the Jira Cloud REST API v3 ([resource index](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)). Today's code substitutes project components and local-workspace scans (`src/discovery/jira.ts`). → `listRepositories` is optional for Jira; the contract needs an explicit degraded mode.
2. **Azure has no scope introspection endpoint.** PAT scopes are fixed at creation and cannot be queried, only behaviorally probed — the entire design of `src/azure/scopes.ts`. → `verifyScopes` is a probe-based capability whose results are best-effort classifications, not authoritative scope lists.
3. **Jira API tokens have no scopes.** Basic-auth tokens carry the user's full permissions; only permission introspection exists (`/rest/api/3/mypermissions`). → `verifyScopes` for Jira can at best check *permissions* and must report "no scope model" for tokens.
4. **GitHub scope introspection only works for classic PATs/OAuth tokens.** `X-OAuth-Scopes` headers are returned for OAuth-scoped tokens ([scopes doc](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)); fine-grained PATs expose no scope header, only 403 diagnostics via `X-Accepted-GitHub-Permissions`.
5. **GitHub rate-limit exhaustion returns 403 or 429** — ambiguous with permission failures on status code alone; the contract must read `x-ratelimit-remaining` and `retry-after` headers. Azure (429 + `TF400733` + `Retry-After`) and Jira (429 + `Retry-After`) are unambiguous.
6. **Azure can return HTML sign-in pages instead of JSON**, including on 2xx/203 responses. Any provider error contract must not assume a JSON error body for Azure; the code already carries an HTML sanitizer for this (`src/discovery/azure.ts:206-291`).
7. **Jira legacy search endpoint is being removed.** `GET /rest/api/3/search` is documented as "Currently being removed" in favor of `/rest/api/3/search/jql` ([issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/)); `src/trackers/jira.ts:21` uses the legacy endpoint.
8. **Jira CAPTCHA lockout** (`X-Seraph-LoginReason: AUTHENTICATION_DENIED`) is a distinct failure mode that maps to neither bad credentials nor permissions; the error contract needs a category for it.
9. **Credential verification is not uniformly implemented today.** Azure verifies via the repos list (`src/azure/connection.ts:100`); GitHub and Jira have no dedicated verify call at all. All three have a suitable cheap endpoint: `GET /user` (GitHub), `GET _apis/projects` (Azure), `GET /rest/api/3/myself` (Jira).
10. **Azure global PAT retirement (Dec 1, 2026).** Only organization-scoped PATs will keep working ([PAT doc](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops)) — provider configuration should capture the org URL and reject global PAT expectations.

---

## 5. Implications for the provider contract (summary)

- A provider adapter should expose, per capability area: `verifyCredentials` (cheap whoami-style GET — `GET /user`, `GET _apis/projects`, `GET /rest/api/3/myself`), optional `verifyScopes` (header introspection for GitHub, behavioral probes for Azure, permission checks for Jira), optional `listRepositories` (absent for Jira), `listTickets` (labels/state filter per provider), and shared error normalization that understands each provider's 401/403/404/429 semantics and body shapes.
- Status-code semantics differ enough (GitHub 403 ambiguity, Azure HTML bodies, Jira CAPTCHA) that the error contract must normalize per provider into a common internal enum, not pass raw statuses through.
- Rate limits are signaled with headers in all three providers; the contract should require reading `Retry-After` / `x-ratelimit-*` / `X-RateLimit-*` rather than status codes.

---

## 6. Source index

**GitHub docs**: [Authenticating to the REST API](https://docs.github.com/en/rest/authentication/authenticating-to-the-rest-api) · [Managing your personal access tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token) · [Get the authenticated user](https://docs.github.com/en/rest/users/users#get-the-authenticated-user) · [Scopes for OAuth apps (X-OAuth-Scopes)](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps) · [Repositories endpoints](https://docs.github.com/en/rest/repos/repos) · [Issues endpoints](https://docs.github.com/en/rest/issues/issues) · [Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) · [Troubleshooting / error shapes](https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api)

**Azure DevOps docs**: [Use personal access tokens](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops) · [Projects - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/core/projects/list?view=azure-devops-rest-7.1) · [Repositories - List](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/repositories/list?view=azure-devops-rest-7.1) · [Statuses - Create](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/statuses/create?view=azure-devops-rest-7.1) · [Scope definitions (OAuth/PAT)](https://learn.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops) · [Rate and usage limits](https://learn.microsoft.com/en-us/azure/devops/integrate/concepts/rate-limits?view=azure-devops) · [WIQL syntax](https://learn.microsoft.com/en-us/azure/devops/boards/queries/wiql-syntax?view=azure-devops)

**Jira Cloud docs**: [Basic auth for REST APIs](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/) · [REST API v3 — Myself](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/) · [REST API v3 — Permissions](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-permissions/) · [REST API v3 — Issue search](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/) · [REST API v3 — About (status codes, Error Collection, resource index)](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/) · [Rate limiting](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)

**Repo code (commit `0cc27f6`)**: `src/trackers/{types,github,azure,jira,jira-adf,schemas,index}.ts` · `src/azure/{auth,connection,scopes,pr,status}.ts` · `src/discovery/{azure,github,jira,local,schemas,types,index}.ts` · `src/github.ts`







