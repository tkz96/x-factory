// src/http/providers-controller.ts — Provider manifest, credential verification, and Quick-URL resolution.
//
// Decided in wayfinder #127, #128, #129, and ticket #137:
// - GET /api/providers/manifest: Provider descriptors, capability declarations, and config fields.
//   Supports role filtering and validates cross-role field uniqueness.
//   CRITICAL SECURITY INVARIANT: envKey is never exposed.
// - POST /api/providers/verify: Credential verification. Transport errors -> 400;
//   Semantic validation errors (incompatible role, config schema) -> 409;
//   Returns VerificationResult (ideal/degraded) or normalized ProviderError envelope.
// - POST /api/providers/parse-url: URL intake via parseQuickUrl. Returns draft or un-matched payload.
// - POST /api/providers/describe: Presentation-only connection identity (#133
//   story 34) via the optional `describeConnection` capability. Answers
//   `{ providerId, identity: null }` with 200 for a provider without the
//   capability and for a configuration that identifies nothing — a surface may
//   never fail to render because a description was unavailable.

import { z } from "zod/v4";
import { toTypedProviderConfig } from "../providers/config-validation.js";
import type {
  Provider,
  ProviderConfig,
  ProviderErrorEnvelope,
  ProviderRole,
  VerificationResult,
} from "../providers/contract.js";
import { hasCapability } from "../providers/contract.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import { presentDeclaredSecretFields } from "../providers/secret-routing.js";
import {
  type ProviderDescriptor,
  serializeProvider,
} from "../providers/serializer.js";
// The ONE definition of a presentable identity, shared with the read that
// attaches it to a line: an empty identity is nothing to show, on either side.
import { presentableIdentity } from "../shared/connection-identity.js";
import { errorResponse, jsonResponse, withValidatedBody } from "./responses.js";

/**
 * Request shape shared by every provider route that takes one connection
 * config: credential verification (`/verify`) and repository discovery
 * (`/repositories`). One shape means the two routes can never drift apart.
 */
const ProviderConfigBodySchema = z.object({
  providerId: z.string().min(1, "providerId is required"),
  role: z.enum(["tracker", "gitHost", "git-host"]).optional(),
  config: z.record(z.string(), z.unknown()),
});

/**
 * Why a provider connection route's semantic ladder refused the request. The
 * refusal itself is always the same codes-only 409 envelope; the reason is what
 * lets a PRESENTATION-ONLY route (`/describe`) treat one refusal differently
 * without inspecting response bodies.
 */
type ProviderRouteRejection =
  | "UNKNOWN_PROVIDER"
  | "INCOMPATIBLE_ROLE"
  | "INVALID_CONFIG";

/** Outcome of the semantic validation ladder every provider route runs. */
type ProviderRoutePrelude =
  | {
      readonly ok: false;
      readonly reason: ProviderRouteRejection;
      readonly response: Response;
    }
  | {
      readonly ok: true;
      readonly provider: Provider;
      readonly config: ProviderConfig;
      /** The normalized role the connection was resolved under, or null. */
      readonly role: ProviderRole | null;
    };

/** Outcome of the ROUTING half of the ladder: provider lookup → role. */
type ProviderRouteRouting =
  | {
      readonly ok: false;
      readonly reason: "UNKNOWN_PROVIDER" | "INCOMPATIBLE_ROLE";
      readonly response: Response;
    }
  | {
      readonly ok: true;
      readonly provider: Provider;
      /** The normalized role the connection was resolved under, or null. */
      readonly role: ProviderRole | null;
    };

/**
 * Provider lookup → role compatibility, the half of the ladder that is about the
 * REQUEST rather than the configuration. `/describe` runs only this half: it is
 * presentation-only and must compose an identity from the fields it is given, so
 * it may not gate on a full-schema parse a secret-free configuration would fail
 * (#133 correction 1).
 */
function resolveProviderRouting(
  registry: ProviderRegistry,
  body: { providerId: string; role?: string | undefined },
): ProviderRouteRouting {
  const provider = registry.get(body.providerId);
  if (!provider) {
    return {
      ok: false,
      reason: "UNKNOWN_PROVIDER",
      response: jsonResponse({ formErrors: ["UNKNOWN_PROVIDER"] }, 409),
    };
  }

  if (!body.role) {
    return { ok: true, provider, role: null };
  }

  const role = normalizeRole(body.role);
  if (!role || !provider.roles.includes(role)) {
    return {
      ok: false,
      reason: "INCOMPATIBLE_ROLE",
      response: jsonResponse(
        { formErrors: ["INCOMPATIBLE_CONFIGURATION"] },
        409,
      ),
    };
  }
  return { ok: true, provider, role };
}

/**
 * The semantic ladder every provider connection route runs before executing a
 * capability: routing (above) then server-authoritative config parsing.
 * Extracted so `/verify` and `/repositories` can never validate differently
 * (#129: transport failures are 400, semantic failures are 409, and every
 * failure carries codes only — never a message).
 */
function resolveProviderRoutePrelude(
  registry: ProviderRegistry,
  body: {
    providerId: string;
    role?: string | undefined;
    config: Record<string, unknown>;
  },
): ProviderRoutePrelude {
  const routing = resolveProviderRouting(registry, body);
  if (!routing.ok) {
    return {
      ok: false,
      reason: routing.reason,
      response: routing.response,
    };
  }

  const parsed = toTypedProviderConfig(routing.provider, body.config);
  if (!parsed.ok) {
    return {
      ok: false,
      reason: "INVALID_CONFIG",
      response: jsonResponse({ fieldErrors: parsed.fieldErrors }, 409),
    };
  }

  return {
    ok: true,
    provider: routing.provider,
    config: parsed.config,
    role: routing.role,
  };
}

/**
 * Normalizes role filter strings ("git-host" -> "gitHost").
 */
function normalizeRole(raw: string): ProviderRole | null {
  if (raw === "git-host" || raw === "gitHost") {
    return "gitHost";
  }
  if (raw === "tracker") {
    return "tracker";
  }
  return null;
}

/**
 * GET /api/providers/manifest
 * Returns descriptors for all registered providers (or filtered by role).
 */
export async function handleManifestRoute(
  _req: Request,
  url: URL,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<Response> {
  const roleParam = url.searchParams.get("role");
  let roleFilter: ProviderRole | undefined;

  if (roleParam !== null && roleParam.length > 0) {
    const normalized = normalizeRole(roleParam);
    if (!normalized) {
      return errorResponse(
        "Invalid role filter. Allowed values: tracker, git-host, gitHost",
        400,
      );
    }
    roleFilter = normalized;
  }

  const descriptors: ProviderDescriptor[] = [];
  for (const provider of registry.values()) {
    const descriptor = serializeProvider(provider, roleFilter);
    if (descriptor) {
      descriptors.push(descriptor);
    }
  }

  return jsonResponse(descriptors, 200);
}

/**
 * POST /api/providers/verify
 * Validates request shape (400), provider semantics (409), then executes verifyCredentials.
 */
export async function handleVerifyRoute(
  req: Request,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<Response> {
  return withValidatedBody(req, ProviderConfigBodySchema, async (body) => {
    const prelude = resolveProviderRoutePrelude(registry, body);
    if (!prelude.ok) {
      return prelude.response;
    }

    try {
      const verification: VerificationResult =
        await prelude.provider.verifyCredentials(prelude.config);
      return jsonResponse(verification, 200);
    } catch (err: unknown) {
      const userError: ProviderErrorEnvelope = prelude.provider.toUserError(
        err,
        "VERIFY",
      );
      return jsonResponse(userError, 200);
    }
  });
}

/**
 * POST /api/providers/parse-url
 * Slices URL through registered providers supporting parseQuickUrl.
 */
export async function handleParseUrlRoute(
  req: Request,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return errorResponse("Invalid JSON in request body.", 400);
  }

  let urlStr: string | undefined;

  if (typeof rawBody === "string") {
    urlStr = rawBody.trim();
  } else if (
    rawBody &&
    typeof rawBody === "object" &&
    "url" in rawBody &&
    typeof (rawBody as { url: unknown }).url === "string"
  ) {
    urlStr = (rawBody as { url: string }).url.trim();
  }

  if (!urlStr || urlStr.length === 0) {
    return errorResponse("Missing or invalid 'url' in request body.", 400);
  }

  for (const provider of registry.values()) {
    if (hasCapability(provider, "parseQuickUrl")) {
      try {
        const draft = provider.parseQuickUrl(urlStr);
        if (draft !== null) {
          return jsonResponse(
            {
              matched: true,
              providerId: provider.id,
              configDraft: draft.configDraft,
              ...(draft.inferredName !== undefined
                ? { inferredName: draft.inferredName }
                : {}),
            },
            200,
          );
        }
      } catch {
        // Degrade cleanly; never leak provider-generated text or internal error strings.
      }
    }
  }

  return jsonResponse(
    {
      code: "UNKNOWN",
      context: urlStr,
      matched: false,
      url: urlStr,
    },
    200,
  );
}

/**
 * POST /api/providers/repositories
 * Repository discovery for a git-host connection. Layering mirrors
 * `handleVerifyRoute` exactly: transport (400) → semantics (409) → execution.
 * A thrown provider error normalizes to the `DISCOVERY` envelope in a 200
 * body; a provider-generated message never crosses this boundary.
 */
export async function handleRepositoriesRoute(
  req: Request,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<Response> {
  return withValidatedBody(req, ProviderConfigBodySchema, async (body) => {
    const prelude = resolveProviderRoutePrelude(registry, body);
    if (!prelude.ok) {
      return prelude.response;
    }

    const { provider, config, role } = prelude;

    // Capability compatibility: the provider must be able to discover.
    if (!hasCapability(provider, "listRepositories")) {
      return jsonResponse({ formErrors: ["INCAPABLE_PROVIDER"] }, 409);
    }

    // Discovery execution
    try {
      const repositories = await provider.listRepositories(config);
      return jsonResponse(
        {
          providerId: provider.id,
          roles: role === null ? [] : [role],
          repositories,
        },
        200,
      );
    } catch (err: unknown) {
      const userError: ProviderErrorEnvelope = provider.toUserError(
        err,
        "DISCOVERY",
      );
      return jsonResponse(userError, 200);
    }
  });
}

/**
 * POST /api/providers/describe
 * The connection's identity as its provider describes it (#133 story 34).
 *
 * PRESENTATION-ONLY, AND SECRET-FREE BY CONSTRUCTION. This route exists so a
 * surface can render `"GitHub (owner/repo)"` without knowing what a provider is,
 * and it reads the connection's NON-SECRET fields only: the identity of every
 * provider is composed from coordinates that are not credentials, and the route
 * never asks for the rest. A configuration is therefore never parsed against the
 * full provider schema — a secret-free configuration would fail that gate and
 * take the identity down with it (#133 correction 1) — and a request that
 * carries a value in a field the provider declares `.meta({ secret: true })` is
 * refused rather than described. Credentials travel exactly once, in the
 * creation request, and this read is not a second occasion.
 *
 * Failure policy, in the order it is applied:
 *
 *   - an unknown provider and an incompatible role mirror the shared routing
 *     ladder exactly (codes-only 409), because those are routing mistakes rather
 *     than descriptions that could not be produced;
 *   - a payload carrying a declared secret field VALUE is the same kind of
 *     mistake — a client still sending credentials for a display read — and is
 *     refused codes-only, so the value is never handed to a capability and never
 *     reachable from the response;
 *   - a provider without the `describeConnection` capability answers
 *     `{ providerId, identity: null }` with 200 — a safe fallback, not an error;
 *   - a configuration that identifies nothing answers the same, because
 *     describing a connection blocks nothing;
 *   - a capability that throws anyway (the contract says it is total) ALSO
 *     answers `{ providerId, identity: null }` with 200: degrading keeps the
 *     route presentation-only, and keeps the thrown text — which may quote a
 *     configuration — off the wire entirely.
 *
 * The payload carries codes and the provider's own short identity string; no
 * provider-generated message, and never a configuration value beyond the
 * identity the provider composed.
 */
export async function handleDescribeRoute(
  req: Request,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<Response> {
  return withValidatedBody(req, ProviderConfigBodySchema, async (body) => {
    const routing = resolveProviderRouting(registry, body);
    if (!routing.ok) {
      return routing.response;
    }

    const { provider } = routing;
    if (
      presentDeclaredSecretFields(provider.configSchema, body.config).length > 0
    ) {
      return jsonResponse({ formErrors: ["SECRET_NOT_ACCEPTED"] }, 409);
    }

    if (!hasCapability(provider, "describeConnection")) {
      return jsonResponse({ providerId: provider.id, identity: null }, 200);
    }

    try {
      return jsonResponse(
        {
          providerId: provider.id,
          identity: presentableIdentity(
            provider.describeConnection({ ...body.config }),
          ),
        },
        200,
      );
    } catch {
      return jsonResponse({ providerId: provider.id, identity: null }, 200);
    }
  });
}
