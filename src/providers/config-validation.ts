// src/providers/config-validation.ts — Server-authoritative validation of a
// provider config against the provider's own zod schema (#128/#131).
//
// Responses carry codes, never messages: provider/zod validation messages must
// never cross the API boundary. Both the verify endpoint and project creation
// validate through this one helper so the codes cannot drift.

import type { z } from "zod/v4";
import type { ProviderConfig, ProviderConfigSchema } from "./contract.js";
import { migrateConfigForProvider } from "./legacy-migration.js";

/** Per-field validation code returned to the client. */
export type FieldErrorCode = "REQUIRED" | "INVALID";

export type ProviderConfigParseResult =
  | { ok: true; config: ProviderConfig }
  | {
      ok: false;
      fieldErrors: Record<string, FieldErrorCode>;
      /** Set when legacy shapes disagreed; internal text, never sent to clients. */
      conflict?: string;
    };

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

/**
 * THE entry point that turns a raw config into the typed config an adapter
 * receives (#186): the legacy migration step first (conflicting legacy values
 * are rejected, never silently collapsed), then the provider's own schema.
 * Every path that hands config to an adapter goes through here.
 *
 * `allowIncomplete` is for diagnostics that must REPORT missing credentials
 * themselves (the scope diagnostic): a schema failure then yields the migrated
 * config, while a legacy conflict is still rejected.
 */
export function toTypedProviderConfig(
  provider: {
    readonly id: string;
    readonly configSchema: ProviderConfigSchema;
  },
  raw: unknown,
  options: { readonly allowIncomplete?: boolean } = {},
): ProviderConfigParseResult {
  let migrated: ProviderConfig;
  try {
    migrated = migrateConfigForProvider(provider.id, raw);
  } catch (err) {
    return {
      ok: false,
      fieldErrors: { config: "INVALID" },
      conflict: (err as Error).message,
    };
  }
  const parsed = parseProviderConfig(provider.configSchema, migrated);
  if (!parsed.ok && options.allowIncomplete) {
    return { ok: true, config: migrated };
  }
  return parsed;
}
