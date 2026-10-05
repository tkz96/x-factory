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
  GET /api/providers/manifest
  POST /api/providers/verify
  POST /api/providers/parse-url
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
   - **Ideal**: `{ "status": "ok", "warnings": [] }`
   - **Degraded**: `{ "status": "degraded", "warnings": [{ "kind": "CAPABILITY_UNCONFIRMED", "capability": "verifyScopes" }] }`
   - **Provider Error**: `{ "code": "AUTH_INVALID", "context": "VERIFY" }`

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

## 4. End-to-End Curl Demo with Stub Provider

Run the demo script or execute curl requests against a running server:

```bash
# 1. Manifest discovery (with optional role filtering)
curl -s http://localhost:3777/api/providers/manifest
curl -s "http://localhost:3777/api/providers/manifest?role=git-host"

# 2. Credential verification (ideal)
curl -s -X POST http://localhost:3777/api/providers/verify \
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
curl -s -X POST http://localhost:3777/api/providers/parse-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://stub.example/acme/rocket"}'
```

---

## 5. Post-Absorption Provider Behavior Invariants (#141)

After the absorb-and-delete completed (legacy tracker/discovery/Azure/GitHub-client
families deleted), these behavior invariants are the contract for every built-in
provider module. They are mechanically guarded by
`test/provider-agnostic-gate.test.ts` (no provider conditionals or provider-module
imports outside `src/providers/`) and by the registry-level serialization gate.

### PR creation is API-only
`createPullRequest` and `findExistingPullRequest` execute **REST API calls with
explicit provider credentials only**. No CLI executable, no ambient machine
authentication, no fallback path. Upstream API errors propagate through the
provider error envelope; they are never retried against a local CLI. The
ticket-write path therefore never hard-depends on the `gh` CLI runtime (deviation
retro-sanctioned on #138).

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

---

## 6. Project Creation with the Normalized Connections Payload (#131/#145)

`POST /api/projects` accepts either the legacy configuration body or the
normalized onboarding payload. The payload is the contract the wizard submits at
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
- `gitIdentity` is a project-level field — never nested inside a connection.
- Secret values ride inline in `config` exactly once. The response, the events,
  the diagnostics and the structured logs never echo them, and the stored project
  record holds only the provider's non-secret configuration.
- `connections` is **additive** to the legacy `issueTracker`/`repositoryPath`/
  `defaultBranch`/`testCommand` fields, which stay populated so queue, deliver
  and readiness keep resolving. No runtime redesign, no config migration of
  existing projects (#133 open question 2).

### Secret routing (server-authoritative)

The server derives which fields are secrets, and where they are stored, from the
registered provider's own schema metadata (`.meta({ secret: true, envKey })`).
Client metadata is never trusted; `envKey` never appears in a client-facing
descriptor or the manifest. The writer strips every declared secret field from
the config and stores its value in per-project env storage
(`~/.x-factory/projects/<projectId>/.env`, mode `0600`) under the declared key.
No provider conditional exists in this path.

### Ordered writes (crash safety)

1. Validate the complete request in memory: transport shape (zod) → provider
   config schema → role/capability compatibility → duplicate id.
2. Write secrets to env storage (`saveProjectEnv`, idempotent — a retry
   converges by overwriting).
3. Append the project record last, as the commit point.

A crash between (2) and (3) leaves a benign orphaned env file and no project; a
failure during (2) leaves neither. A project can never exist without its secrets.

### Error channels

| Failure | Status | Body |
| --- | --- | --- |
| Transport shape (zod) | 400 | `{ error, details }` |
| Unknown provider id | 409 | `{ formErrors: ["UNKNOWN_PROVIDER"] }` |
| Provider config schema | 409 | `{ fieldErrors: { field: "REQUIRED" \| "INVALID" } }` |
| Role/capability mismatch, duplicate provider, knowledge-only repositories | 409 | `{ formErrors: ["INCOMPATIBLE_CONFIGURATION"] }` |
| Duplicate project id (create-only) | 409 | `{ error }` |
| Persistence failure | 500 | `{ error }` |

Codes only — provider and zod messages never cross the boundary. Upstream
failures use the separate `ProviderError` envelope.

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

### Known limitation

The legacy tracker summary (`GET /api/projects/:id/tracker`) returns
`secretKey` — the project's env variable *name* — which predates this contract
and is asserted by `test/projects-api.test.ts`. It carries no secret value; the
redaction invariant covers every response, and the env-key invariant covers the
surfaces this contract owns plus the manifest.

### Test seam

`X_FACTORY_CONFIG_PATH` overrides the projects configuration file path (the same
injection seam as `X_FACTORY_DATA_DIR` / `X_FACTORY_DB_PATH`), so tests can point
both the project record and the env storage at a temp directory.
