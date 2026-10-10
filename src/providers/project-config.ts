// src/providers/project-config.ts — Project tracker operations (#141, #172).
//
// Tracker operations resolve their connection through the project connections
// module and read secret field names and env keys from the provider schema.
// The only provider-keyed shape is the migration request (`ProjectMigrationInput`),
// whose per-provider tracker fields are the wire contract for that route.

import { z } from "zod/v4";
import { SemanticValidationError, ValidationError } from "../errors.js";
import { maskSecret } from "../settings.js";
import type {
  IssueTrackerProvider,
  Project,
  ProjectConnection,
  ProjectIssueTracker,
} from "../shared/types.js";
import { toTypedProviderConfig } from "./config-validation.js";
import type {
  Provider,
  ProviderErrorEnvelope,
  ProviderRole,
} from "./contract.js";
import {
  type ResolvedProjectConnection,
  resolveConnectionForRole,
  secretRoutesOf,
  storedSecretValue,
} from "./project-connections.js";
import { PROVIDER_REGISTRY, type ProviderRegistry } from "./registry.js";
import { routeConnectionSecrets } from "./secret-routing.js";

/**
 * Maps a request's secret value onto a provider's own secret field name.
 *
 * A body keyed by the schema's field name is taken as it is. A body keyed by one
 * of the generic aliases (`token`, `secret`, `pat`) is accepted only for a
 * provider with exactly one secret field, where the alias cannot be ambiguous.
 */
function secretBodyValues(
  provider: Provider,
  body: Record<string, unknown>,
): Record<string, string> {
  const routes = secretRoutesOf(provider);
  const values: Record<string, string> = {};
  for (const route of routes) {
    const direct = body[route.name];
    if (typeof direct === "string") {
      values[route.name] = direct;
    }
  }
  const [only] = routes;
  if (routes.length === 1 && only && values[only.name] === undefined) {
    for (const alias of ["token", "secret", "pat"]) {
      const aliased = body[alias];
      if (typeof aliased === "string") {
        values[only.name] = aliased;
        break;
      }
    }
  }
  return values;
}

/**
 * Derives the legacy `ProjectIssueTracker` mirror from the tracker connection.
 *
 * The mirror is written on every record for API compatibility. The runtime never
 * reads it back: resolution goes through the project connections module.
 */
export function deriveIssueTracker(
  providerId: string,
  config: Record<string, unknown>,
): ProjectIssueTracker {
  const tracker: Record<string, unknown> = {
    provider: providerId as IssueTrackerProvider,
    connectionId: providerId,
  };

  const project = config.project;
  if (typeof project === "string" && project.trim()) {
    tracker.projectId = project.trim();
  }

  const orgUrl = config.orgUrl;
  if (typeof orgUrl === "string" && orgUrl.trim()) {
    tracker.orgUrl = orgUrl.trim();
  }

  tracker[providerId] = config;

  return tracker as unknown as ProjectIssueTracker;
}

export interface ProjectTrackerSummary {
  provider: string;
  config: Record<string, unknown>;
  hasSecret: boolean;
  secretMask: string;
  secretKey: string;
}

/**
 * The project's tracker connection: its provider, non-secret config, and the
 * status of its first secret (where it is stored and whether a value exists).
 */
export function resolveProjectTrackerSummary(
  project: Project,
  env: Record<string, string>,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): ProjectTrackerSummary {
  // Resolved through the project connections module: the connection (even when
  // it names a provider the registry no longer has) plus that provider.
  const resolved = resolveConnectionForRole(project, "tracker", registry);
  const provider = resolved?.provider;
  const [route] = provider ? secretRoutesOf(provider) : [];

  const secret = route ? storedSecretValue(route.envKey, env) : "";
  const hasSecret = Boolean(secret.trim());

  return {
    provider: resolved?.connection.providerId ?? "",
    config: { ...(resolved?.connection.config ?? {}) },
    hasSecret,
    secretMask: hasSecret ? maskSecret(secret) : "",
    secretKey: route?.envKey ?? "",
  };
}

/**
 * Maps a credentials request onto the env keys the provider's secrets live
 * under. Returns nothing for a provider the registry does not know.
 */
export function extractTrackerCredentialsToSave(
  body: Record<string, unknown>,
  provider: Provider | undefined,
): Record<string, string> {
  if (!provider) return {};
  const values = secretBodyValues(provider, body);
  const varsToSave: Record<string, string> = {};
  for (const route of secretRoutesOf(provider)) {
    const value = values[route.name];
    if (value !== undefined) varsToSave[route.envKey] = value;
  }
  return varsToSave;
}

/**
 * The outcome of a live tracker probe. A success carries the canonical
 * confirmation copy; a failure carries the provider's normalized (code,
 * context) envelope — never the raw thrown text, which can echo a token or the
 * configuration (#183).
 */
export type TrackerTestResult =
  | { ok: true; message: string }
  | { ok: false; error: ProviderErrorEnvelope };

/**
 * Executes a live connection probe with the provider resolved for the project's
 * STORED tracker connection: its recorded config plus the secrets the project's
 * env storage holds. Nothing from a request body reaches the provider; the
 * caller supplies only the resolved connection and the repository coordinate.
 */
export async function testProjectTrackerConnection(
  connection: ResolvedProjectConnection,
  repositoryPath: string,
): Promise<TrackerTestResult> {
  const { provider, config } = connection;
  try {
    await provider.verifyCredentials({ ...config, cwd: repositoryPath });
    return {
      ok: true,
      message: `${provider.displayName} connection successful.`,
    };
  } catch (err: unknown) {
    // Normalized envelope only: the thrown text, which may quote a token or the
    // configuration, never crosses this boundary.
    return { ok: false, error: provider.toUserError(err, "VERIFY") };
  }
}

/**
 * The wire contract for POST /api/projects/:id/migrate (#163 B1): the target
 * provider, its target-keyed non-secret fields and the secrets to route. The
 * HTTP body schema derives from this schema, so the transport contract and the
 * migration input can never drift.
 */
export const ProjectMigrationInputSchema = z.looseObject({
  targetProvider: z
    .string({ error: "targetProvider is required." })
    .trim()
    .min(1, "targetProvider is required."),
  newProjectId: z.string().optional(),
  name: z.string().optional(),
  secrets: z.record(z.string(), z.string()).optional(),
  azure: z.record(z.string(), z.unknown()).optional(),
  jira: z.record(z.string(), z.unknown()).optional(),
  github: z.record(z.string(), z.unknown()).optional(),
});

export type ProjectMigrationInput = z.infer<typeof ProjectMigrationInputSchema>;

/**
 * One connection of a migration plan: the connection as it will be persisted
 * (secret-free) plus the secret values it carries, keyed by env key. The shape
 * matches the shared connection-set write plan's `PreparedConnection` (#187)
 * without importing it, so the providers layer stays inside its zone.
 */
export interface MigrationConnectionPlan {
  providerId: string;
  roles: ProviderRole[];
  connection: ProjectConnection;
  secrets: Record<string, string>;
}

/** Everything a migration write needs, decided before any write. */
export interface MigrationPlan {
  newId: string;
  newProject: Project;
  archivedOldProject: Project;
  /** Non-empty secret values keyed by env key. */
  secretsToSave: Record<string, string>;
  /**
   * The successor's connection set with its secrets, or `undefined` for a
   * legacy successor (a project that carries no connection set stays legacy).
   */
  connections: MigrationConnectionPlan[] | undefined;
}

/** Reads a request's provider-keyed section, tolerating any JSON value. */
function providerSection(
  body: ProjectMigrationInput,
  providerId: string,
): Record<string, unknown> {
  const raw = (body as unknown as Record<string, unknown>)[providerId];
  return raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
}

/**
 * Builds the successor project model, the archived predecessor model, and the
 * credentials mapping (#163 B1).
 *
 * Everything is decided BEFORE any write. The target connection is assembled
 * from the stored connection (when the target provider already served the
 * project), the request's own non-secret fields, and its secret fields — the
 * request's value first, the stored value for a field the request omits, so a
 * migration that does not re-enter a credential keeps the one already stored.
 * The assembled config is validated through the shared `toTypedProviderConfig`
 * entry point and split by `routeConnectionSecrets`, so a declared secret can
 * never be persisted on the project record and the legacy `issueTracker` mirror
 * is derived from the secret-free connection, never from the request body.
 *
 * The successor's connection set is the target plus every other connection with
 * its tracker role removed, so a surviving git host keeps serving the project.
 * Each connection carries its secret values for the shared write plan; a
 * project that has no connection set stays legacy (`connections: undefined`).
 */
export function buildProjectMigrationPlan(
  project: Project,
  body: ProjectMigrationInput,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
  storedEnv: Record<string, string> = {},
): MigrationPlan {
  const provider = registry.get(body.targetProvider);
  if (!provider) {
    throw new SemanticValidationError({ formErrors: ["UNKNOWN_PROVIDER"] });
  }

  const newId =
    body.newProjectId?.trim() || `${project.id}-${body.targetProvider}`;

  const previousConnections = project.connections ?? [];
  const previousTarget = previousConnections.find(
    (connection) => connection.providerId === provider.id,
  );
  const targetRoles: ProviderRole[] = previousTarget?.roles.includes("gitHost")
    ? ["tracker", "gitHost"]
    : ["tracker"];

  const effective: Record<string, unknown> = {
    ...(previousTarget?.config ?? {}),
  };
  for (const [key, value] of Object.entries(
    providerSection(body, provider.id),
  )) {
    if (value !== undefined) effective[key] = value;
  }
  const requestSecrets = secretBodyValues(
    provider,
    (body.secrets ?? {}) as Record<string, unknown>,
  );
  for (const route of secretRoutesOf(provider)) {
    const provided = requestSecrets[route.name];
    if (provided !== undefined) {
      effective[route.name] = provided;
      continue;
    }
    const stored = storedSecretValue(route.envKey, storedEnv);
    if (stored) effective[route.name] = stored;
    else delete effective[route.name];
  }

  const parsed = toTypedProviderConfig(provider, effective);
  if (!parsed.ok) {
    throw new ValidationError(
      "Invalid provider configuration for the migration target.",
      "INVALID_CONFIG",
    );
  }
  const routed = routeConnectionSecrets(provider.configSchema, parsed.config);
  const target: MigrationConnectionPlan = {
    providerId: provider.id,
    roles: targetRoles,
    connection: {
      providerId: provider.id,
      roles: targetRoles,
      config: routed.config,
    },
    secrets: routed.secrets,
  };

  // Survivors: every other connection with its tracker role removed; the
  // secrets already stored for it travel with it.
  const survivors: MigrationConnectionPlan[] = previousConnections
    .filter((connection) => connection.providerId !== provider.id)
    .map((connection) => ({
      ...connection,
      roles: connection.roles.filter((role) => role !== "tracker"),
    }))
    .filter((connection) => connection.roles.length > 0)
    .map((connection) => {
      const connectionProvider = registry.get(connection.providerId);
      const secrets: Record<string, string> = {};
      if (connectionProvider) {
        for (const route of secretRoutesOf(connectionProvider)) {
          const value = storedSecretValue(route.envKey, storedEnv);
          if (value) secrets[route.envKey] = value;
        }
      }
      return {
        providerId: connection.providerId,
        roles: [...connection.roles],
        connection,
        secrets,
      };
    });

  const connections =
    previousConnections.length > 0 ? [target, ...survivors] : undefined;

  const secretsToSave: Record<string, string> = { ...target.secrets };
  for (const survivor of survivors) {
    for (const [envKey, value] of Object.entries(survivor.secrets)) {
      secretsToSave[envKey] = value;
    }
  }

  const newProject: Project = {
    ...project,
    id: newId,
    name: body.name?.trim() || project.name,
    issueTracker: deriveIssueTracker(provider.id, target.connection.config),
    connections: connections?.map((connection) => connection.connection),
    archived: false,
    archivedAt: undefined,
    successorId: undefined,
    predecessorId: project.id,
  };

  const archivedOldProject: Project = {
    ...project,
    archived: true,
    archivedAt: new Date().toISOString(),
    successorId: newId,
  };

  return {
    newId,
    newProject,
    archivedOldProject,
    secretsToSave,
    connections,
  };
}
