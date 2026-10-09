# Provider API Specification

This reference specification defines the provider-agnostic HTTP surface for provider discovery, configuration descriptor generation, credential verification, and Quick-URL resolution.

---

## 1. Architectural Authority & Overview

The provider API surface implements the HTTP boundary between the provider system and client applications (such as the project onboarding wizard).

```text
  Provider Registry (Static)
              ↓
  Zod-to-Descriptor Serializer
              ↓
  Provider HTTP Controllers
              ↓
  GET  /api/providers/manifest
  POST /api/providers/verify
  POST /api/providers/parse-url
  POST /api/providers/repositories
  POST /api/providers/describe
```

### Core Invariants

1. **Security Invariant (No Secret Leakage)**:
   - Secret routing metadata (`envKey`) declared in provider configuration schemas is strictly server-side metadata.
   - `envKey` and raw credential values are **never** included in client-facing field descriptors or any manifest HTTP response.
2. **Copy Map & Message Boundary**:
   - Provider-generated raw messages, error strings, and exception text never cross the HTTP boundary.
   - Validation failures return machine-readable error codes (`REQUIRED`, `INVALID`, `INCOMPATIBLE_CONFIGURATION`, `UNKNOWN_PROVIDER`).
   - Upstream provider errors return normalized `ProviderError` envelopes (`AUTH_INVALID`, `AUTH_LOCKED`, `NOT_FOUND`, `RATE_LIMITED`, `PERMISSION`, `UNKNOWN`).
3. **Fail-Loud Serialization Gate**:
   - Provider configuration schemas (`configSchema`) must strictly adhere to the supported Zod subset. Any schema outside the subset fails loudly with `SchemaSerializationError` at test/build time.

---

## 2. Supported Zod Subset for Configuration Schemas

Every provider exports a `configSchema: z.ZodType<Record<string, unknown>>`.
The generic serializer (`serializeProviderConfigSchema`) parses this schema into UI field descriptors.

### Allowed Schema Constructs

- **Root Type**: Must be a `z.object({...})`.
- **Field Primitive**: Must unwrap to `z.string()`.
- **Allowed Wrappers**: `.optional()` and `.default(...)`.
- **Allowed String Checks**: `.min(...)`, `.max(...)`, `.url()`, `.email()`, `.trim()`.
- **Required Metadata**: Every field must declare `.meta(metadata)`:
  - `label` (string, required): Human-readable field label.
  - `uiType` (`"text" | "secret" | "url" | "email"`, required): Control presentation type.
  - `secret` (boolean, optional): Set to `true` for credential fields. When `true`, `uiType` must be `"secret"`, and `envKey` must be declared.
  - `envKey` (string, optional): Required if and only if `secret: true`. Forbidden on non-secret fields.
  - `roles` (`("tracker" | "gitHost")[]`, optional): Restricts the field to specific provider roles.
  - `placeholder` (string, optional): Input placeholder copy.
  - `help` (string, optional): Field guidance text.

### Strictly Forbidden Constructs (Fails Loudly)

- Root schemas that are not objects (e.g. primitives, unions, arrays).
- Non-string field types (e.g. `z.number()`, `z.boolean()`, `z.array()`, `z.date()`).
- Refinements and transforms (`.refine()`, `.superRefine()`, `.transform()`, `.pipe()`).
- Duplicating schema-derived properties in `.meta()` (e.g. `.meta({ required: true })`).
- Unknown or unexpected properties in `.meta()`.
- Duplicate field names within a provider schema across roles.

---

## 3. Endpoints

### A. GET /api/providers/manifest

Returns UI descriptors for registered providers and their configuration fields.

#### Query Parameters
- `role` (optional, string): Filters providers and fields by role. Allowed values: `tracker`, `git-host`, `gitHost`.

#### Response Shape (`200 OK`)
```json
[
  {
    "id": "stub",
    "displayName": "Stub Provider",
    "roles": ["tracker", "gitHost"],
    "iconRef": "provider-stub",
    "capabilities": ["verifyScopes", "parseQuickUrl"],
    "configFields": [
      {
        "name": "host",
        "label": "Host",
        "type": "url",
        "required": true
      },
      {
        "name": "apiToken",
        "label": "API token",
        "type": "secret",
        "required": true,
        "secret": true,
        "help": "Stored in per-project environment storage."
      },
      {
        "name": "project",
        "label": "Project",
        "type": "text",
        "required": true
      }
    ]
  }
]
```

---

### B. POST /api/providers/verify

Verifies connection credentials for a provider and role.

#### Request Body
```json
{
  "providerId": "stub",
  "role": "tracker",
  "config": {
    "host": "https://stub.example",
    "apiToken": "secret-pat",
    "project": "my-project"
  }
}
```

#### Validation Layering
1. **Transport Validation (`400 Bad Request`)**: Missing `providerId`, non-object `config`, or invalid `role` format.
2. **Semantic Validation (`409 Conflict`)**:
   - Unknown provider: `{ "formErrors": ["UNKNOWN_PROVIDER"] }`
   - Incompatible role: `{ "formErrors": ["INCOMPATIBLE_CONFIGURATION"] }`
   - Config schema validation failure: `{ "fieldErrors": { "apiToken": "REQUIRED" } }`
3. **Execution (`200 OK`)**:
   - **Ideal**: `{ "status": "ok", "warnings": [] }` (or `{ "status": "ok", "warnings": [], "overPrivileged": true }`)
   - **Degraded**: `{ "status": "degraded", "warnings": [{ "kind": "CAPABILITY_UNCONFIRMED", "capability": "createPullRequest", "missingScopes": ["repo"] }] }` (optionally with `"overPrivileged": true`)
   - **Provider Error**: `{ "code": "AUTH_INVALID", "context": "VERIFY" }`

   `overPrivileged` (boolean, optional): set to `true` when the provider detects that the credential possesses broader permissions than required (such as repository deletion or organization administrative scopes).

   `missingScopes` (string[], optional): present on a warning when token scopes were introspectable and one or more required scopes are provably absent. When scopes are not visible (e.g. fine-grained personal access tokens), capabilities are reported as unconfirmed without `missingScopes`.

---

### C. POST /api/providers/parse-url

Parses a repository or tracker URL into a configuration draft.

#### Request Body
```json
{
  "url": "https://stub.example/acme/rocket"
}
```

#### Response Shape
- **Recognized URL (`200 OK`)**:
  ```json
  {
    "matched": true, "providerId": "stub",
    "configDraft": {
      "host": "https://stub.example",
      "project": "rocket"
    },
    "inferredName": "rocket"
  }
  ```
- **Unrecognized URL (`200 OK`)**:
  ```json
  {
    "matched": false,
    "url": "https://unrecognized.example/unknown"
  }
  ```

---

### D. POST /api/providers/repositories

Repository discovery for a git-host connection (ticket #144). The list a project
is built from comes exclusively from here — the wizard never scans the local
disk and never accepts a hand-entered repository.

#### Request Body
```json
{
  "providerId": "stub",
  "role": "gitHost",
  "config": {
    "host": "https://stub.example",
    "apiToken": "secret-pat",
    "project": "my-project"
  }
}
```
`role` is optional and accepts `tracker`, `gitHost`, or the `git-host` alias;
it names the connection role the repositories are listed under.

#### Validation Layering
1. **Transport Validation (`400 Bad Request`)**: Malformed JSON, missing
   `providerId`, or a non-object `config`.
2. **Semantic Validation (`409 Conflict`)** — the same machine-readable codes as
   `/verify`:
   - Unknown provider: `{ "formErrors": ["UNKNOWN_PROVIDER"] }`
   - Role the provider does not declare: `{ "formErrors": ["INCOMPATIBLE_CONFIGURATION"] }`
   - Config schema validation failure: `{ "fieldErrors": { "apiToken": "REQUIRED" } }`
   - Provider without the `listRepositories` capability (e.g. Jira as git host):
     `{ "formErrors": ["INCAPABLE_PROVIDER"] }`
3. **Execution (`200 OK`)**:
   - **Success**: a provider-agnostic envelope — no provider terminology crosses
     the boundary:
     ```json
     {
       "providerId": "stub",
       "roles": ["gitHost"],
       "repositories": [
         {
           "id": "repo-1",
           "name": "rocket-app",
           "remote": "https://stub.example/acme/rocket-app.git",
           "defaultBranch": "main",
           "webUrl": "https://stub.example/acme/rocket-app"
         }
       ]
     }
     ```
   - **Provider Error**: `{ "code": "AUTH_INVALID", "context": "DISCOVERY" }`.
     The provider's own status/body text is normalized inside the provider
     module and never reaches the client.

---

### E. POST /api/providers/describe

The connection's identity as its provider describes it (spec #133 story 34). This
is the ONLY way a surface learns an identity: the provider composes it from its
own configuration (`"owner/repo"`, `"acme.atlassian.net/ROCK"`), and the wizard,
the project card, the project detail view and the settings registry all render
the answer the same way, as `displayName (identity)`.

The route exists so a surface can render that string **without knowing what a
provider is**: it is driven by the optional `describeConnection` capability, and
there is no provider name anywhere on the path.

#### Capability

`describeConnection(config: ProviderConfig): string | null` — declared in
`CAPABILITIES` (`src/providers/contract.ts`) and implemented by each provider
module. It is TOTAL by contract: it never throws, and it reads only the
NON-SECRET coordinates of a connection (`src/providers/connection-identity.ts`
holds the shared field/URL/join helpers). A provider that does not declare the
capability is not an error — it simply has no identity to publish.

#### Request Body

```json
{
  "providerId": "github",
  "config": { "repoOwner": "octo-org", "repository": "rocket" }
}
```

**Secret-free by construction (#133 correction 1).** A credential travels
exactly once, in the creation request; this read is not a second occasion. A
surface builds the body from the connection's NON-SECRET fields — the frontend
projects each connection through the manifest's own `secret` declarations before
asking (`identityConfig`) — and the server refuses a request that brings a
declared secret VALUE anyway. The route therefore never parses the configuration
against the full provider schema: that gate demands credentials (GitHub's schema
requires `token`), and a secret-free configuration would fail it and take the
identity down with it. The identity is composed from what the request DOES
carry, which is why a partial-but-identifying configuration answers rather than
degrading.

#### Response Shape

- **Described (`200 OK`)**: `{ "providerId": "github", "identity": "octo-org/rocket" }`
- **Nothing to describe (`200 OK`)**: `{ "providerId": "stub", "identity": null }` —
  the provider declares no `describeConnection` capability, or the configuration
  identifies nothing (an empty part is reported as absent, never rendered as
  `"Name ()"`), or the capability threw despite its contract. Describing a
  connection blocks nothing, so a non-answer is never an error a user sees: the
  surface renders the plain display name.
- **Transport (`400 Bad Request`)**: malformed JSON, missing `providerId`, or a
  non-object `config`.
- **Semantic (`409 Conflict`, codes only)**:
  - Unknown provider: `{ "formErrors": ["UNKNOWN_PROVIDER"] }`
  - Role the provider does not declare: `{ "formErrors": ["INCOMPATIBLE_CONFIGURATION"] }`
  - A declared secret field carrying a value:
    `{ "formErrors": ["SECRET_NOT_ACCEPTED"] }` — the refusal names no field and
    echoes no value, and the request is never handed to the capability.

The payload carries no provider-generated message, and never a configuration
value beyond the identity the provider composed. `test/provider-describe-api.test.ts`
asserts the raw response bytes, and `test/connection-identity-hook.test.tsx`
asserts the secret-free body for each of GitHub, Azure and Jira.

---

## 4. End-to-End Curl Demo with Stub Provider

Run the demo script or execute curl requests against a running server:

```bash
# 1. Manifest discovery (with optional role filtering)
curl -s http://127.0.0.1:3777/api/providers/manifest
curl -s "http://127.0.0.1:3777/api/providers/manifest?role=git-host"

# 2. Credential verification (ideal)
curl -s -X POST http://127.0.0.1:3777/api/providers/verify \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "stub",
    "role": "tracker",
    "config": {
      "host": "https://stub.example",
      "apiToken": "valid-token",
      "project": "acme-app"
    }
  }'

# 3. Quick-URL intake
curl -s -X POST http://127.0.0.1:3777/api/providers/parse-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://stub.example/acme/rocket"}'

# 4. Repository discovery for a git-host connection
curl -s -X POST http://127.0.0.1:3777/api/providers/repositories \
  -H "Content-Type: application/json" \
  -d '{
    "providerId": "stub",
    "role": "gitHost",
    "config": {
      "host": "https://stub.example",
      "apiToken": "valid-token",
      "project": "acme-app"
    }
  }'

# 5. Connection identity (presentation-only, secret-free: no credential here)
curl -s -X POST http://127.0.0.1:3777/api/providers/describe \
  -H "Content-Type: application/json" \
  -d '{"providerId": "github", "config": {"repoOwner": "acme", "repository": "web"}}'
```

---

## 5. Post-Absorption Provider Behavior Invariants (#141)

After the absorb-and-delete completed (legacy tracker/discovery/Azure/GitHub-client
families deleted), these behavior invariants are the contract for every built-in
provider module. They are mechanically guarded by
`test/provider-agnostic-gate.test.ts` and by the registry-level serialization gate.

The provider-agnostic gate scans production source outside `src/providers/**`
for provider-specific coupling and reports: a concrete provider lookup
(`getProvider("github")`, `requireProvider("jira")`), a registry lookup by a
provider-id literal (`.get("azure")`), a provider-id literal in a comparison
(`===`, `!==`, `==`, `!=` — on either side), a `case`, or a ternary, a
provider-id literal used to SELECT behaviour (`TABLES["azure"]`, a computed key
`{ ["azure"]: … }`), and the legacy tracker/discovery/Azure/GitHub-client/
provider-submodule imports. Its scanner is a function of (relative path, source
text) — `scanContent` — and is itself gated by negative fixtures (what must be
reported, each asserted under its rule name) and positive fixtures (provider-zone
paths, the audited allowlist, a test-fixture path, and a generic consumer that
does capability dispatch, dynamic lookup, and `Headers.get("content-type")`).

Two details bound what the gate can hide and what it can see:

- **Import rules read the whole file, and exemptions name rules.** Import
  specifiers are extracted over the file's content, not line by line, so a
  house-style WRAPPED import (`import {` / `githubProvider,` /
  `} from "../providers/github-module.js"`) is reported exactly like a
  single-line one; the specifier alone is tested, so a comment mentioning a path
  never trips a rule. An allowlist entry exempts the rules it NAMES and nothing
  else — the one entry (`frontend/views/DocsView.tsx`, whose docs URL slug
  selects which static security article renders) covers the switch/copy
  selection only, and a provider lookup or provider-module import in that file is
  reported like anywhere else. A file-level "skip everything" exemption is not
  expressible.

- **Recorded precision boundaries.** A record literal KEYED by provider ids
  (`{ azure: matchAzure, github: matchGitHub }`) is data, not branching, and is
  not reported — using a provider id to select FROM such a table is. The gate
  also does not see provider-id PROPERTY ACCESS (`p.issueTracker?.azure`): that
  shape appears legitimately in the legacy tracker view
  (`src/config-schema.ts`, `src/providers/project-config.ts`) and in
  `src/shared/project-identity.ts`, which cannot delegate to the provider
  registry or the migration step because `.fallowrc.json` lets `shared` import
  nothing (it reads the same historical aliases itself, read-only) while the
  duplicate check runs in the browser. Both limits are recorded rather than
  hidden: the gate is a text scanner over shipped source, and a rule for either
  shape would report far more legitimate code than it would catch.

### PR creation is API-only
`createPullRequest` and `findExistingPullRequest` execute **REST API calls with
explicit provider credentials only**. No CLI executable, no ambient machine
authentication, no fallback path. Upstream API errors propagate through the
provider error envelope; they are never retried against a local CLI. The
ticket-write path therefore never hard-depends on the `gh` CLI runtime (deviation
retro-sanctioned on #138).

How PR failures surface (#184): the registry hands out providers whose
capability calls throw a normalized `ProviderError` (see "Registry error
contract" below), so a failed `createPullRequest` or `findExistingPullRequest`
reaches delivery already carrying `PR` context and canonical copy. Delivery does
not check capabilities or normalize errors itself. A provider without
`createPullRequest` is wrapped so the call throws the canonical `PR` error
(`UNKNOWN`: "An unexpected error occurred while creating the pull request. Try
again."), while `hasCapability` still reports the capability as absent. The
deliver stage fails with exactly that message, and the worker logs only the
message, never the raw provider failure kept as `cause`.

### Registry error contract (#184)

`getProvider`, `requireProvider` and `listProviders` return a wrapper around the
registered provider; the provider object itself is never modified, and one
wrapper is built per provider and reused. Every call to `verifyCredentials`,
`verifyScopes`, `listRepositories`, `listTickets`, `createPullRequest` and
`findExistingPullRequest` either resolves or throws a `ProviderError` class
instance (distinct from the `ProviderErrorEnvelope` wire type in the contract)
with:

- `code` and `context` from the provider's `toUserError`, with the context
  fixed by the capability (`VERIFY`: `verifyCredentials`, `verifyScopes`;
  `DISCOVERY`: `listRepositories`; `TICKETS`: `listTickets`; `PR`:
  `createPullRequest`, `findExistingPullRequest`);
- `message` set to the canonical copy for that `(code, context)` pair
  (`PROVIDER_ERROR_MESSAGES` in `src/providers/errors.ts`), never provider text;
- `retryAfterMs` only when the provider supplied a positive wait;
- the raw failure only as `cause`.

A `ProviderError` thrown by a provider is re-tagged with the capability's
context. Callers catch `ProviderError`; they do not call `toUserError`.

### `parseQuickUrl` accepted URL shapes (GitHub reference)
- `https://github.com/owner/repo` — full HTTPS URL → git-host config draft
  (owner + repo) plus inferred project name.
- `git@github.com:owner/repo.git` (and `.git`-less SSH forms) — accepted for the
  same reason users paste them; parsed into the same draft shape.
- `github.com/owner` — owner-only draft with `repoOwner` set and repo left empty
  (feeds repository discovery in the Connect step).
- Anything else returns `matched: false`; the endpoint never guesses.

### Error-envelope mapping (GitHub reference)
- `429`, or `403` with rate-limit evidence (`retry-after` header,
  `x-ratelimit-remaining: 0`, rate-limit body text) → `RATE_LIMITED`, with
  `retryAfterMs` only when the server actually supplied a future value
  (`retry-after`, or `x-ratelimit-reset` still in the future). A reset in the
  past yields no `retryAfterMs` — the module never invents one.
- A `401` with a `retry-after` header is strictly an auth error (`AUTH_INVALID`),
  never rate-limiting.
- `403` without rate-limit evidence → `PERMISSION`, distinct from `AUTH_INVALID`.

### Ticket listing
`listTickets` filters by the contract-required `requiredLabel` and lists **open**
tickets only — the inspection flow consumes actionable tickets; closed tickets
are deliberately excluded. Providers that gain a consumer needing a different
state filter must extend the contract input, not the query behind it.

### Typed provider config (#186)
Adapters receive **typed config** and nothing else: the shape their own
`configSchema` declares. They never search for aliased or nested keys.

- **Declared fields.** The GitHub schema declares `token`, `repoOwner`,
  `repository` and `baseUrl` (a GitHub Enterprise API base URL, validated as a
  URL, optional, default `https://api.github.com`). `resolveGitHubConfig` reads
  those four fields directly.
- **One migration step.** `src/providers/legacy-migration.ts` is the only place
  historical shapes are reconciled: aliases (`owner`, `org`, `organization`,
  `repo`, `githubToken`, `jiraHost`, ...), `repo: "owner/name"`, URL hints, and
  nested views (`github`, `gitHost`, `tracker`, `azure`, `jira`, `config`,
  `connections[]`). A legacy Azure `org`/`organization` maps to
  `https://dev.azure.com/<org>` as `orgUrl`. Fields the step does not own (for
  example `requiredLabel`) are kept. Providers with no legacy shapes pass
  through unchanged.
- **Where it runs.** (1) When stored connections are read:
  `loadProjectConnections` migrates every stored connection and the legacy
  `issueTracker` fallback (narrowed to the provider's own section plus flat
  scalar keys), so ticket listing and delivery resolve legacy records; the
  repository coordinate is derived from `repoOwner/repository`. The alias list
  lives once in `src/shared/legacy-aliases.ts`. (2) On
  every request body, through **`toTypedProviderConfig(provider, raw)`** in
  `src/providers/config-validation.ts`: migration first, then the provider's
  schema. It backs `/api/providers/verify|repositories`, the project routes
  `test-connection`, `discover-repositories` and `test-scopes`, project creation
  and connection updates, and the project connection test. The Azure adapter
  keeps one defensive conflict check of its own. Duplicate detection in
  `src/shared` reads the same aliases without importing the step.
- **Where conflicts are rejected.** Two legacy values that disagree (two owners,
  two tokens, two repositories, two base URLs, an organization that is not the
  one in `orgUrl`) are a conflict, never silently collapsed or stripped. At the
  entry point the result is `{ ok: false, conflict }`: provider routes answer
  `409 { fieldErrors: { config: "INVALID" } }` (codes only), and the project
  routes answer with a generic "incomplete, invalid or conflicting" message. No
  provider HTTP call is made. A STORED connection whose shapes conflict raises
  `ConnectionConflictError` (code `CONNECTION_CONFLICT`): readiness lists it as
  an issue, project routes answer `409` with that code, and delivery fails with
  the same message. Nothing picks one of the values.

- **Shared ticket normalization module (`src/providers/ticket-normalization.ts`).**
  Ticket text is turned into acceptance criteria through one shared extractor
  (`extractAcceptanceCriteria`) across all three providers (#185). Adapters only
  convert their provider-specific representations to text (Markdown for GitHub,
  ADF for Jira, HTML for Azure). ADF headings are emitted in Markdown format so
  subsequent headings terminate the criteria section across all providers.
  For Azure, HTML heading conversion (`<h1-6>` to `##`) is limited to criteria
  extraction, keeping the stored description clean plain text. When a dedicated
  Acceptance Criteria field is present on an Azure work item, every non-empty line
  is preserved as a criterion (or parsed if formatted with markdown/HTML lists),
  with no fallback to the description.

- **Page cap policy (`resolvePageCap`).**
  Listing is paginated up to a page cap: `TicketQueryOptions.pageCap` when specified,
  falling back to `DEFAULT_PAGE_CAP` (10, defined in `src/providers/http.ts`).
  GitHub previously followed `Link: rel="next"` without a cap; it is now capped
  identically to Jira and Azure (#185).

- **Silent truncation warning.**
  When pagination terminates because the page cap was reached while additional
  tickets or pages remain, `listTickets` emits a structured warning via the logger
  naming the provider, the cap, and that results were truncated (`truncated: true`).
  When all available tickets fit within the cap, no warning is emitted.

- **Azure Work Item ID batching.**
  Azure DevOps WIQL queries return work item ID references. Work items are retrieved
  by batching IDs in chunks of up to 200 (the Azure DevOps API maximum). Pagination
  fetches up to `pageCap` batches of work items, de-duplicating IDs and ignoring
  missing or null IDs.

---

## 6. Project Creation with the Normalized Connections Payload (#131/#145)

`POST /api/projects` accepts either the legacy configuration body or the
normalized onboarding payload. The validated input union's own discrimination
decides the path (`isConnectionsProjectInput`): a body that satisfies the
normalized connections branch creates through it, and every other body keeps the
legacy configuration path. The payload is the contract the wizard submits at
Review (#146):

```jsonc
{
  "id": "my-project",
  "name": "My Project",
  "workspacePath": "/Users/dev/code",
  "gitIdentity": { "name": "Ada Lovelace", "email": "ada@example.com" },
  "connections": [
    { "providerId": "jira",   "roles": ["tracker"], "config": { "host": "…", "email": "…", "apiToken": "…", "project": "PROJ" } },
    { "providerId": "github", "roles": ["gitHost"], "config": { "token": "…", "repoOwner": "acme", "repository": "web" } }
  ],
  "repositories": [
    { "id": "my-project-web", "name": "web", "remote": "…", "defaultBranch": "main", "localPath": "/Users/dev/code/web", "role": "frontend", "primary": true }
  ]
}
```

- A dual-role provider (`tracker` **and** `gitHost`) is **one** connection
  carrying both roles; two providers are two connections. Two connections of the
  same provider are rejected (`INCOMPATIBLE_CONFIGURATION`) rather than merged.
- **Both connection roles are mandatory** (#133): a connection set is accepted
  only when it covers `tracker` **and** `gitHost` — supplied either as two
  connections or as one dual-role connection. A set covering only one role is
  rejected before any write with the code(s) for the uncovered role:
  `MISSING_TRACKER_CONNECTION` and/or `MISSING_GIT_HOST_CONNECTION` (both codes at
  once when both roles are missing, so one rejection teaches both gaps). A
  project the post-creation integrity surface would immediately flag as broken
  therefore cannot be created in the first place. The same rule applies to a
  connection update, checked against the **merged** result. A connections payload
  covering only ONE role is rejected on create **and** on update — a tracker-only
  set reports `MISSING_GIT_HOST_CONNECTION` and a git-host-only set reports
  `MISSING_TRACKER_CONNECTION`, neither is silently completed.
- **A body with no `connections` array must name a usable tracker too.** Such a
  body — the legacy configuration shape, whether it carries `repositoryPath`
  alone or an explicit `repositories` array — is not exempt from the
  "a created project must be operable" rule; it is the same rule in the form that
  body can express, and it is applied to the SAME payloads: a git-host-only or
  tracker-only *connections* payload is still rejected with the codes above, and
  a body with no tracker identity is rejected by this one. A legacy record has no
  connection set by design, because its git host IS its repository:
  `repositoryPath` plus that repository's remote. What it must supply is an
  `issueTracker` naming a tracker the registry can serve, named either explicitly
  (`issueTracker.provider`, or its historical alias `connectionId`) or implicitly
  by the namespaced view the configuration lives under (`{ "azure": { … } }`,
  `{ "jira": { … } }`, `{ "github": { … } }` — the keying `deriveIssueTracker`
  writes). A body that names none is rejected before any write with
  `{ formErrors: ["MISSING_TRACKER_CONNECTION"] }` — the same code the
  connections path reports — so a record whose tracker would only be the legacy
  default cannot be created through the API any more. A named provider that is
  not registered is `UNKNOWN_PROVIDER`; one that is registered but cannot serve
  the tracker role, or cannot `listTickets`, is `INCOMPATIBLE_CONFIGURATION`.
  Neither branch writes a secret for a rejected request.
- `gitIdentity` is a project-level field — never nested inside a connection.
- Secret values ride inline in `config` exactly once. The response, the events,
  the diagnostics and the structured logs never echo them, and the stored project
  record holds only the provider's non-secret configuration.
- `connections` is **additive** to the legacy `issueTracker`/`repositoryPath`/
  `defaultBranch`/`testCommand` fields, which stay populated so queue, deliver
  and readiness keep resolving. No runtime redesign, no config migration of
  existing projects (#133 open question 2).
- The legacy view is **derived from the connection**, never re-typed by the
  client: `deriveIssueTracker` namespaces the tracker connection's own (secret-free)
  config under the provider id and mirrors the flat fields that share a config
  field's name. The view's schema therefore has to accept the provider's real
  field names, or a created project cannot be read back: `loadProjects` validates
  every record, so a strict legacy view rejects the record the creation path just
  wrote. `issueTracker.github` accepts both the legacy flat `repo` and the
  canonical `repoOwner`/`repository` field names for exactly this reason (fixed
  in #148, where the tri-provider journeys caught `loadProjects` throwing for a
  project onboarded through the wizard).

### Secret routing (server-authoritative)

The server derives which fields are secrets, and where they are stored, from the
registered provider's own schema metadata (`.meta({ secret: true, envKey })`).
Client metadata is never trusted; `envKey` never appears in a client-facing
descriptor or the manifest. The writer strips every declared secret field from
the config and stores its value in per-project env storage
(`~/.x-factory/projects/<projectId>/.env`, mode `0600`) under the declared key.
No provider conditional exists in this path.

### Ordered writes (crash safety)

The shipped sequence for a creation from the normalized connections payload, with
the role-coverage gate (#133) and the per-id creation claim in place:

1. **Validate the complete request in memory** — transport shape (zod) → provider
   config schema → role/capability compatibility → required-role coverage →
   duplicate providers. Pure, so it runs OUTSIDE the claim: an invalid payload
   must not contend for one, and no secret is written for a request that will be
   rejected.
2. **Take the per-id creation claim** (`withCreationClaim`), then **re-check the
   duplicate id** inside it. The claim is what makes the sequence safe against a
   concurrent creation of the SAME id: without it two creations both pass an
   in-memory duplicate check, both write secrets, and only then does one lose the
   record append — leaving the winner's secret overwritten by the loser's
   values. The claim files live under `getLocksDir()` (`~/.x-factory/locks/`,
   `X_FACTORY_DATA_DIR`-relative) as `create-<readable-id>-<digest>.claim`, one
   per candidate id, released when the
   create returns or throws; a holder that outlives the TTL is reclaimable, and
   that residual is documented in `src/services/creation-claim.ts`. A claim not
   taken within the wait bound is reported as the same 409 as the duplicate.
3. **Write secrets to env storage** (`saveProjectEnv`, idempotent — a retry
   converges by overwriting).
4. **Append the project record last**, as the commit point.
5. **Release the claim.**

A crash between (3) and (4) leaves a benign orphaned env file and no project; a
failure during (3) leaves neither. A project can never exist without its secrets.
A body without a `connections` array (the legacy shape) takes the same ordered
write through `createProject`, after the tracker gate above.

### Error channels

| Failure | Status | Body |
| --- | --- | --- |
| Transport shape (zod) | 400 | `{ error, details }` |
| Unknown provider id | 409 | `{ formErrors: ["UNKNOWN_PROVIDER"] }` |
| Provider config schema | 409 | `{ fieldErrors: { field: "REQUIRED" \| "INVALID" } }` |
| Role/capability mismatch, duplicate provider, knowledge-only repositories | 409 | `{ formErrors: ["INCOMPATIBLE_CONFIGURATION"] }` |
| Connection set covers only one role (create), the merged set would after an update, or a body without `connections` names no usable tracker | 409 | `{ formErrors: ["MISSING_TRACKER_CONNECTION" \| "MISSING_GIT_HOST_CONNECTION"] }` |
| Duplicate project id (create-only) | 409 | `{ error }` |
| Persistence failure | 500 | `{ error }` |
| Provider failure on `GET /api/projects/:id/tickets` (and any route that lets a `ProviderError` reach the domain-error ladder) | by code, below | `{ error, code, context, retryAfterMs? }` |

Codes only — provider and zod messages never cross the boundary. Upstream
failures use the separate `ProviderError` envelope.

The provider-failure body is built in one place (`providerErrorResponse` in
`src/http/responses.ts`): `error` is the canonical copy, `code` and `context`
come from the `ProviderError`, and `retryAfterMs` is present only when known.
The status follows the code:

| `code` | Status |
| --- | --- |
| `AUTH_INVALID` | 401 |
| `PERMISSION` | 403 |
| `NOT_FOUND` | 404 |
| `AUTH_LOCKED` | 423 |
| `RATE_LIMITED` | 429, with a `Retry-After` header in whole seconds when `retryAfterMs` is known |
| `UNKNOWN` | 502 |

### Scope diagnostic (`POST /api/projects/test-scopes`, legacy alias `POST /api/projects/test-azure-scopes`)

The canonical endpoint is `POST /api/projects/test-scopes`, with `POST /api/projects/test-azure-scopes`
retained as a legacy wire alias for backward compatibility. Its RESOLUTION names no
provider (#141). The provider a diagnostic runs against is resolved in this
order, and nothing else is consulted:

1. an explicit `providerId` in the body, which must be registered;
2. otherwise the tracker connection recorded on the body's `projectId`;
3. otherwise nothing resolves, and the request is answered with the honest
   `{ ok: false, scopes: {}, errors: ["No tracker connection resolved …"] }`
   copy.

The resolved provider is then dispatched through
`hasCapability(provider, "verifyScopes")`: a provider that does not declare the
capability is reported as a capability gap in provider-agnostic copy, never
substituted for, and a provider that does declare it answers with the findings
for its own capabilities.

The historical Azure-shaped body (`{ orgUrl, project, pat }`) names NEITHER a
provider nor a project, so it resolves nothing and is answered as unresolved —
the route does not fall back to a provider-shaped body, because a generic
consumer must not branch on a concrete provider identity. A client that wants a
diagnostic for a specific connection sends `providerId` or `projectId`
(`src/http/openapi.ts` documents the accepted body, with the registry's real id
as the example). `test/provider-scope-diagnostics.test.ts` covers the resolution
order and the gap copy against an injected registry; `test/integration.test.ts`
covers both outcomes against the shipped one.

### Secret update semantics

`PATCH`/`PUT /api/projects/:id` with a `connections` array follows the same
contract:

- A missing or empty secret field **keeps** the stored secret (an empty string is
  never overloaded to mean delete).
- A non-empty value **replaces** it.
- An explicit sibling `clearSecrets: fieldName[]` removes stored secrets. It is
  applied **before** validation, so clearing a required secret correctly fails
  with `{ fieldErrors: { <field>: "REQUIRED" } }` and writes nothing.
- Unknown `clearSecrets` names fail with `{ fieldErrors: { <name>: "INVALID" } }`.
- The **merged** connection set (the project's existing connections plus the
  update, which replaces a connection wholesale) must still cover both roles: an
  update that would leave the project without a tracker or without a git host is
  rejected with the same `formErrors` codes as creation, before any secret is
  written.

### Known limitation

The legacy tracker summary (`GET /api/projects/:id/tracker`) returns
`secretKey` — the project's env variable *name* — which predates this contract
and is asserted by `test/projects-api.test.ts`. It carries no secret value; the
redaction invariant covers every response, and the env-key invariant covers the
surfaces this contract owns plus the manifest.

### Test seam

`X_FACTORY_CONFIG_PATH` overrides the projects configuration file path, which
defaults to `./config/projects.json` (a repository file, deliberately not moved under
the data dir). It is the same injection seam as `X_FACTORY_DATA_DIR` / `X_FACTORY_DB_PATH`, so tests can point
both the project record and the env storage at a temp directory.
