// src/providers/project-connections.ts — The project connections module (#172).
//
// Answers one question for every caller: "which connection serves role R for
// project P", as the provider plus its fully resolved, schema-validated config.
//
// - `connections` is the source of truth. A project created or updated through
//   the normalized connections payload is read from it directly.
// - A legacy record (no `connections` array) is read through
//   `loadProjectConnections`, a READ-ONLY loader that derives the same shape
//   from the legacy `issueTracker` mirror. Nothing in the runtime reads
//   `issueTracker` any other way.
// - Secret values never live in `connections`. They are merged into the config
//   from per-project env storage by each provider schema's own `envKey`
//   metadata (`getSecretFieldRoutes`). No provider name and no env-key table
//   appears in this module.

import type { Project, ProjectConnection } from "../shared/types.js";
import type { Provider, ProviderConfig, ProviderRole } from "./contract.js";
import { PROVIDER_REGISTRY, type ProviderRegistry } from "./registry.js";
import { getSecretFieldRoutes } from "./secret-routing.js";

/** A connection resolved for one role, ready to call the provider with. */
export interface ResolvedProjectConnection {
  providerId: string;
  provider: Provider;
  /** Non-secret configuration with the stored secrets merged in by envKey. */
  config: ProviderConfig;
  /** The repository coordinate the provider calls are scoped to. */
  repository: string;
}

/**
 * The provider id a LEGACY `issueTracker` record names, or `null` when it names
 * none.
 *
 * A legacy record carries no `connections` array, so its tracker is named in one
 * of exactly two ways, and this function reads both without knowing a provider
 * by name:
 *
 *   * explicitly, as `provider` (or its historical alias `connectionId`);
 *   * implicitly, by the NAMESPACED VIEW its configuration lives under, the same
 *     keying `deriveIssueTracker` writes (`tracker[providerId] = config`). A key
 *     the registry does not know is not a tracker identity, so it is skipped.
 */
export function legacyTrackerProviderId(
  issueTracker: unknown,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): string | null {
  if (typeof issueTracker !== "object" || issueTracker === null) {
    return null;
  }
  const record = issueTracker as Record<string, unknown>;
  for (const key of ["provider", "connectionId"] as const) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  for (const [key, view] of Object.entries(record)) {
    if (
      view !== null &&
      typeof view === "object" &&
      !Array.isArray(view) &&
      registry.get(key) !== undefined
    ) {
      return key;
    }
  }
  return null;
}

/**
 * The connections a project has, as the runtime reads them.
 *
 * A record with a `connections` array is returned as stored. A legacy record is
 * mapped once, here: its tracker provider is the one its `issueTracker` names,
 * with the provider's config read from that provider's namespaced view. A legacy
 * record that names no tracker has no connections at all.
 */
export function loadProjectConnections(
  project: Project,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): ProjectConnection[] {
  if (project.connections && project.connections.length > 0) {
    return project.connections;
  }

  const providerId = legacyTrackerProviderId(project.issueTracker, registry);
  if (providerId === null) return [];
  const provider = registry.get(providerId);
  if (!provider) return [];

  const view = project.issueTracker as unknown as Record<string, unknown>;
  const namespaced = view[providerId];
  const config: Record<string, unknown> =
    namespaced !== null && typeof namespaced === "object"
      ? { ...(namespaced as Record<string, unknown>) }
      : {};
  if (
    typeof config.project !== "string" &&
    typeof project.issueTracker.projectId === "string"
  ) {
    config.project = project.issueTracker.projectId;
  }

  const roles = provider.roles.filter(
    (role): role is ProviderRole => role === "tracker" || role === "gitHost",
  );
  return [{ providerId, roles, config }];
}

/** The connection serving `role`, from the loader's connections. */
export function findConnectionForRole(
  project: Project,
  role: ProviderRole,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): ProjectConnection | undefined {
  return loadProjectConnections(project, registry).find((connection) =>
    connection.roles.includes(role),
  );
}

/**
 * Merges each declared secret into the config by its schema `envKey`: the
 * project's own env storage first, then the process environment, exactly as the
 * legacy resolution did. A secret with no value is left out of the config.
 */
export function mergeStoredSecrets(
  provider: Provider,
  config: Record<string, unknown>,
  env: Record<string, string>,
): ProviderConfig {
  const merged: ProviderConfig = { ...config };
  for (const route of getSecretFieldRoutes(provider.configSchema)) {
    const value = storedSecretValue(route.envKey, env);
    if (value) merged[route.name] = value;
  }
  return merged;
}

/** A stored secret for an env key: project env first, then the process env. */
export function storedSecretValue(
  envKey: string,
  env: Record<string, string>,
): string {
  return env[envKey] || process.env[envKey] || "";
}

/**
 * The provider's secret fields, each with the env key it is stored under.
 * Derived from the schema, so a provider adds a secret by declaring it there.
 */
export function secretRoutesOf(
  provider: Provider,
): ReadonlyArray<{ name: string; envKey: string }> {
  return getSecretFieldRoutes(provider.configSchema);
}

/**
 * Resolves the connection serving `role` for a project, or `undefined` when the
 * project has none or its provider is not registered.
 */
export function resolveProjectConnection(
  project: Project,
  role: ProviderRole,
  env: Record<string, string>,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): ResolvedProjectConnection | undefined {
  const connection = findConnectionForRole(project, role, registry);
  if (!connection) return undefined;
  const provider = registry.get(connection.providerId);
  if (!provider) return undefined;

  const config = mergeStoredSecrets(provider, connection.config, env);
  const primaryRepo =
    project.repositories?.find((r) => r.path === project.repositoryPath) ||
    project.repositories?.[0];
  const configuredRepo = config.repo;
  const repository =
    (typeof configuredRepo === "string" && configuredRepo.trim()) ||
    primaryRepo?.name ||
    primaryRepo?.id ||
    project.name ||
    project.id;

  return { providerId: provider.id, provider, config, repository };
}
