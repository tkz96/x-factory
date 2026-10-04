// src/http/providers-controller.ts — Provider manifest, credential verification, and Quick-URL resolution.
//
// Decided in wayfinder #127, #128, #129, and ticket #137:
// - GET /api/providers/manifest: Provider descriptors, capability declarations, and config fields.
//   Supports role filtering and validates cross-role field uniqueness.
//   CRITICAL SECURITY INVARIANT: envKey is never exposed.
// - POST /api/providers/verify: Credential verification. Transport errors -> 400;
//   Semantic validation errors (incompatible role, config schema) -> 409;
//   Returns VerificationResult (ideal/degraded) or normalized ProviderError.
// - POST /api/providers/parse-url: URL intake via parseQuickUrl. Returns draft or un-matched payload.

import { z } from "zod/v4";
import type {
  ProviderError,
  ProviderRole,
  VerificationResult,
} from "../providers/contract.js";
import { hasCapability } from "../providers/contract.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import {
  type ProviderDescriptor,
  serializeProvider,
} from "../providers/serializer.js";
import {
  catchHttpErrors,
  errorResponse,
  jsonResponse,
  withValidatedBody,
} from "./responses.js";

const VerifyBodySchema = z.object({
  providerId: z.string().min(1, "providerId is required"),
  role: z.enum(["tracker", "gitHost", "git-host"]).optional(),
  config: z.record(z.string(), z.unknown()),
});

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
  return withValidatedBody(req, VerifyBodySchema, async (body) => {
    // 1. Semantic validation: Provider lookup
    const provider = registry.get(body.providerId);
    if (!provider) {
      return jsonResponse(
        {
          formErrors: ["UNKNOWN_PROVIDER"],
        },
        409,
      );
    }

    // 2. Semantic validation: Role compatibility
    if (body.role) {
      const normalizedRole = normalizeRole(body.role);
      if (!normalizedRole || !provider.roles.includes(normalizedRole)) {
        return jsonResponse(
          {
            formErrors: ["INCOMPATIBLE_CONFIGURATION"],
          },
          409,
        );
      }
    }

    // 3. Semantic validation: Config schema validation
    const parsedConfig = provider.configSchema.safeParse(body.config);
    if (!parsedConfig.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsedConfig.error.issues) {
        const fieldName = issue.path.join(".") || "config";
        const rawVal = body.config[issue.path[0] as string];
        const isRequired =
          rawVal === undefined || rawVal === null || rawVal === "";
        fieldErrors[fieldName] = isRequired ? "REQUIRED" : "INVALID";
      }
      return jsonResponse(
        {
          fieldErrors,
        },
        409,
      );
    }

    // 4. Verification execution
    try {
      const verification: VerificationResult = await provider.verifyCredentials(
        parsedConfig.data,
      );
      return jsonResponse(verification, 200);
    } catch (err: unknown) {
      const userError: ProviderError = provider.toUserError(err, "VERIFY");
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
    }
  }

  return jsonResponse(
    {
      matched: false,
      url: urlStr,
    },
    200,
  );
}

/**
 * Dispatcher for all /api/providers/* routes.
 */
export async function handleProvidersRoute(
  method: string,
  parts: string[],
  req: Request,
  url: URL,
  customRegistry?: ProviderRegistry,
): Promise<Response> {
  const registry = customRegistry ?? PROVIDER_REGISTRY;
  const action = parts[0];

  if (method === "GET" && action === "manifest") {
    return catchHttpErrors(() => handleManifestRoute(req, url, registry));
  }

  if (method === "POST" && action === "verify") {
    return catchHttpErrors(() => handleVerifyRoute(req, registry));
  }

  if (method === "POST" && action === "parse-url") {
    return catchHttpErrors(() => handleParseUrlRoute(req, registry));
  }

  return errorResponse("Endpoint not found.", 404);
}
