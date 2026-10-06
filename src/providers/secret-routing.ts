// src/providers/secret-routing.ts — Generic secret routing derived from a
// registered provider's own schema (#131/#145).
//
// The server — never the client — decides which config fields are secrets and
// where they are stored: each field's `.meta({ secret: true, envKey })`.
// There are zero provider conditionals in this path; a new provider routes
// its secrets by declaring the metadata, nothing else.

import {
  readConfigFieldSchemas,
  SchemaSerializationError,
  unwrapConfigField,
} from "./schema-meta.js";

/** One declared secret field and the env key its value is stored under. */
export interface SecretFieldRoute {
  /** Field name inside the provider config. */
  name: string;
  /** Environment variable key in per-project env storage. */
  envKey: string;
}

/**
 * Reads the secret fields declared by a provider config schema, with the env
 * key each one is routed to. Server/provider metadata only — `envKey` is never
 * part of a client-facing descriptor.
 */
export function getSecretFieldRoutes(schema: unknown): SecretFieldRoute[] {
  const routes: SecretFieldRoute[] = [];

  for (const field of readConfigFieldSchemas(schema)) {
    const { meta } = unwrapConfigField(field.name, field.schema);
    if (meta?.secret !== true) continue;

    const envKey = meta.envKey;
    if (typeof envKey !== "string" || envKey.trim().length === 0) {
      throw new SchemaSerializationError(
        `Field "${field.name}" is marked secret but is missing "envKey". Secret fields must declare envKey for environment storage.`,
      );
    }
    routes.push({ name: field.name, envKey: envKey.trim() });
  }

  return routes;
}

/**
 * The declared secret fields of a provider config that CARRY A VALUE, by name.
 *
 * The presentation-only describe read must never receive credentials (they
 * travel exactly once, in the creation request), so the route asks this before
 * it hands anything to a capability: a non-empty value in a field the provider's
 * own schema declares `.meta({ secret: true })` is a client that is still
 * sending credentials for a read that composes a display string. A missing or
 * empty value is not a value — it is ignored, not reported.
 *
 * Derived from the schema, so a new provider needs no change here.
 */
export function presentDeclaredSecretFields(
  schema: unknown,
  config: Record<string, unknown>,
): string[] {
  const present: string[] = [];
  for (const route of getSecretFieldRoutes(schema)) {
    const value = config[route.name];
    if (typeof value === "string") {
      if (value.trim() !== "") present.push(route.name);
      continue;
    }
    if (value !== undefined && value !== null) present.push(route.name);
  }
  return present;
}

/** A connection config split into what may be persisted and what is secret. */

export interface RoutedConnectionSecrets {
  /** The provider config with every declared secret field removed. */
  config: Record<string, unknown>;
  /** Non-empty secret values keyed by their declared envKey. */
  secrets: Record<string, string>;
}

/**
 * Splits a connection config into its persistable, secret-free part and the
 * secret values routed to per-project env storage.
 *
 * A missing or empty secret value yields nothing to write — it means "keep
 * whatever is already stored", never "delete" (#131).
 */
export function routeConnectionSecrets(
  schema: unknown,
  config: Record<string, unknown>,
): RoutedConnectionSecrets {
  const cleaned: Record<string, unknown> = { ...config };
  const secrets: Record<string, string> = {};

  for (const route of getSecretFieldRoutes(schema)) {
    const value = cleaned[route.name];
    delete cleaned[route.name];
    if (typeof value === "string" && value.trim().length > 0) {
      secrets[route.envKey] = value.trim();
    }
  }

  return { config: cleaned, secrets };
}
