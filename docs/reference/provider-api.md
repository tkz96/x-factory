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
    "providerId": "stub",
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
    "code": "UNKNOWN",
    "context": {
      "url": "https://unrecognized.example/unknown"
    },
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
