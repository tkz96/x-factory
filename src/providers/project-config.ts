// src/providers/project-config.ts — Project tracker operations (#141, #172).
//
// Tracker operations resolve their connection through the project connections
// module and read secret field names and env keys from the provider schema.
// The only provider-keyed shape is the migration request (`ProjectMigrationInput`),
// whose per-provider tracker fields are the wire contract for that route.

import { maskSecret } from "../settings.js";
import type {
  IssueTrackerProvider,
  Project,
  ProjectConnection,
  ProjectIssueTracker,
} from "../shared/types.js";
import type { Provider, ProviderErrorEnvelope } from "./contract.js";
import {
  type ResolvedProjectConnection,
  resolveConnectionForRole,
  secretRoutesOf,
  storedSecretValue,
} from "./project-connections.js";
import { PROVIDER_REGISTRY, type ProviderRegistry } from "./registry.js";

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

export interface ProjectMigrationInput {
  targetProvider: IssueTrackerProvider;
  name?: string | undefined;
  newProjectId?: string | undefined;
  azure?:
    | { orgUrl: string; project: string; requiredLabel?: string | undefined }
    | undefined;
  jira?:
    | {
        host: string;
        email: string;
        project?: string | undefined;
        requiredLabel?: string | undefined;
      }
    | undefined;
  github?:
    | {
        repo?: string | undefined;
        repoOwner?: string | undefined;
        repository?: string | undefined;
        baseUrl?: string | undefined;
        requiredLabel?: string | undefined;
      }
    | undefined;
  secrets?: { pat?: string; token?: string } | undefined;
}

/**
 * The connections the migrated project has: the target tracker, plus every
 * other connection with its tracker role removed, so a surviving git host keeps
 * serving the project. A project with no connections stays legacy (`undefined`).
 */
function migratedConnections(
  project: Project,
  body: ProjectMigrationInput,
): ProjectConnection[] | undefined {
  if (!project.connections || project.connections.length === 0) {
    return undefined;
  }
  const target = body.targetProvider;
  const previous = project.connections.find((c) => c.providerId === target);
  const trackerConfig = Object.fromEntries(
    Object.entries(
      ((body as unknown as Record<string, unknown>)[target] ?? {}) as Record<
        string,
        unknown
      >,
    ).filter(([, value]) => value !== undefined),
  );
  const targetConnection: ProjectConnection = {
    providerId: target,
    roles: previous?.roles.includes("gitHost")
      ? ["tracker", "gitHost"]
      : ["tracker"],
    config: { ...(previous?.config ?? {}), ...trackerConfig },
  };
  const survivors = project.connections
    .filter((c) => c.providerId !== target)
    .map((c) => ({ ...c, roles: c.roles.filter((r) => r !== "tracker") }))
    .filter((c) => c.roles.length > 0);
  return [targetConnection, ...survivors];
}

export interface MigrationPlan {
  newId: string;
  newProject: Project;
  archivedOldProject: Project;
  secretsToSave: Record<string, string>;
}

/**
 * Builds the successor project model, archived predecessor model, and credentials mapping.
 */
export function buildProjectMigrationPlan(
  project: Project,
  body: ProjectMigrationInput,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
  storedEnv: Record<string, string> = {},
): MigrationPlan {
  const newId =
    body.newProjectId?.trim() || `${project.id}-${body.targetProvider}`;

  const newIssueTracker: ProjectIssueTracker = {
    provider: body.targetProvider,
    connectionId: body.targetProvider,
    azure: body.targetProvider === "azure" ? body.azure : undefined,
    jira: body.targetProvider === "jira" ? body.jira : undefined,
    github: body.targetProvider === "github" ? body.github : undefined,
  };

  const connections = migratedConnections(project, body);
  const newProject: Project = {
    ...project,
    id: newId,
    name: body.name?.trim() || project.name,
    issueTracker: newIssueTracker,
    connections,
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

  const secretsToSave: Record<string, string> = {};
  const provider = registry.get(body.targetProvider);
  const [route] = provider ? secretRoutesOf(provider) : [];
  const secret = Object.values(body.secrets ?? {}).find(
    (value): value is string => typeof value === "string" && value !== "",
  );
  if (route && secret) {
    secretsToSave[route.envKey] = secret;
  }
  // Secrets the surviving connections already hold move with them to the new
  // project id; the target's own secret, when supplied, takes precedence.
  for (const connection of connections ?? []) {
    const connectionProvider = registry.get(connection.providerId);
    if (!connectionProvider) continue;
    for (const { envKey } of secretRoutesOf(connectionProvider)) {
      const carried = storedEnv[envKey];
      if (carried && secretsToSave[envKey] === undefined) {
        secretsToSave[envKey] = carried;
      }
    }
  }

  return {
    newId,
    newProject,
    archivedOldProject,
    secretsToSave,
  };
}
