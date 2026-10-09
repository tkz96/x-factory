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

import {
  legacyTrackerConfig,
  legacyTrackerProviderId as sharedLegacyTrackerProviderId,
} from "../shared/legacy-tracker.js";
import type { Project, ProjectConnection } from "../shared/types.js";
import type { Provider, ProviderConfig, ProviderRole } from "./contract.js";
import {
  getProvider,
  PROVIDER_REGISTRY,
  type ProviderRegistry,
  type RegisteredProvider,
} from "./registry.js";
import { getSecretFieldRoutes } from "./secret-routing.js";

/** A connection resolved for one role, ready to call the provider with. */
export interface ResolvedProjectConnection {
  providerId: string;
  provider: RegisteredProvider;
  /** Non-secret configuration with the stored secrets merged in by envKey. */
  config: ProviderConfig;
  /** The repository coordinate the provider calls are scoped to. */
  repository: string;
}

/**
 * The provider id a legacy record names, judged against the registry. The
 * reader itself lives in `shared/legacy-tracker.ts`, the only legacy reader.
 */
export function registryTrackerProviderId(
  issueTracker: unknown,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): string | null {
  return sharedLegacyTrackerProviderId(issueTracker, (key) =>
    registry.has(key),
  );
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

  const providerId = registryTrackerProviderId(project.issueTracker, registry);
  if (providerId === null) return [];
  const provider = registry.get(providerId);
  if (!provider) return [];
  const config = legacyTrackerConfig(project.issueTracker, providerId);

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
  const provider = getProvider(connection.providerId, registry);
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
