// src/providers/redaction.ts — Redaction-before-serialization (#131/#145).
//
// Cross-cutting invariant: secret-bearing request fields, config objects,
// errors, diagnostics, events and structured logs are redacted before they are
// serialized. Redaction is schema-driven — the same registered provider schema
// that routes a secret to env storage decides what gets masked — so it stays
// provider-agnostic.

import type { ProjectConnection } from "../types.js";
import { getSecretFieldRoutes } from "./secret-routing.js";

/** Mask substituted for every declared secret value. */
export const REDACTED_SECRET_VALUE = "••••••••";

/**
 * Returns a copy of a provider config with every declared secret value
 * replaced by a mask. Missing or empty secrets are left untouched.
 */
export function redactProviderConfig(
  schema: unknown,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...config };

  for (const route of getSecretFieldRoutes(schema)) {
    const value = redacted[route.name];
    if (typeof value === "string" && value.trim().length > 0) {
      redacted[route.name] = REDACTED_SECRET_VALUE;
    }
  }

  return redacted;
}

/**
 * Redacts a config whose provider may not be registered. Registered providers
 * are redacted from their schema; an unknown provider keeps its config as-is
 * (nothing that reaches a stored connection carries a secret in the first
 * place, because routing strips them at write time).
 */
export function redactConfigForProvider(
  provider: { configSchema: unknown } | undefined,
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (!provider) return { ...config };
  return redactProviderConfig(provider.configSchema, config);
}

/**
 * Redacts every stored connection config against its registered provider.
 */
export function redactConnections(
  connections: readonly ProjectConnection[] | undefined,
  registry: ReadonlyMap<string, { configSchema: unknown }>,
): ProjectConnection[] | undefined {
  if (!connections) return undefined;
  return connections.map((connection) => ({
    providerId: connection.providerId,
    roles: [...connection.roles],
    config: redactConfigForProvider(
      registry.get(connection.providerId),
      connection.config,
    ),
  }));
}
