// src/providers/config-validation.ts — Server-authoritative validation of a
// provider config against the provider's own zod schema (#128/#131).
//
// Responses carry codes, never messages: provider/zod validation messages must
// never cross the API boundary. Both the verify endpoint and project creation
// validate through this one helper so the codes cannot drift.

import type { z } from "zod/v4";
import type { ProviderConfig, ProviderConfigSchema } from "./contract.js";

/** Per-field validation code returned to the client. */
export type FieldErrorCode = "REQUIRED" | "INVALID";

export type ProviderConfigParseResult =
  | { ok: true; config: ProviderConfig }
  | { ok: false; fieldErrors: Record<string, FieldErrorCode> };

/**
 * Maps zod issues to per-field codes. A field that is absent, null or empty is
 * REQUIRED; anything else that fails the schema is INVALID.
 */
export function fieldErrorCodes(
  error: z.ZodError,
  config: ProviderConfig,
): Record<string, FieldErrorCode> {
  const fieldErrors: Record<string, FieldErrorCode> = {};

  for (const issue of error.issues) {
    const fieldName = issue.path.join(".") || "config";
    const rawValue = config[issue.path[0] as string];
    const isRequired =
      rawValue === undefined || rawValue === null || rawValue === "";
    fieldErrors[fieldName] = isRequired ? "REQUIRED" : "INVALID";
  }

  return fieldErrors;
}

/**
 * Parses a connection config with its provider's schema. The parsed output is
 * the sanitized config (unknown keys stripped), never the client's raw object.
 */
export function parseProviderConfig(
  schema: ProviderConfigSchema,
  config: ProviderConfig,
): ProviderConfigParseResult {
  const parsed = schema.safeParse(config);
  if (!parsed.success) {
    return { ok: false, fieldErrors: fieldErrorCodes(parsed.error, config) };
  }
  return { ok: true, config: parsed.data };
}
