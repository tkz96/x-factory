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
import { parseProviderConfig } from "./config-validation.js";
import type { Provider, ProviderConfig } from "./contract.js";
import {
  findConnectionForRole,
  mergeStoredSecrets,
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
  const connection = findConnectionForRole(project, "tracker", registry);
  const provider = connection ? registry.get(connection.providerId) : undefined;
  const [route] = provider ? secretRoutesOf(provider) : [];

  const secret = route ? storedSecretValue(route.envKey, env) : "";
  const hasSecret = Boolean(secret.trim());

  return {
    provider: connection?.providerId ?? "",
    config: { ...(connection?.config ?? {}) },
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

/** `text` with every occurrence of each non-empty secret value masked. */
function redactValues(text: string, values: readonly string[]): string {
  let redacted = text;
  for (const value of [...values].sort((a, b) => b.length - a.length)) {
    redacted = redacted.split(value).join("[redacted]");
  }
  return redacted;
}

export interface TrackerTestResult {
  ok: boolean;
  message?: string | undefined;
  error?: string | undefined;
}

/**
 * Executes a live connection probe with the provider. The config is the
 * project's tracker connection when the request names that same provider, with
 * the stored secrets and any non-empty request values layered over it.
 */
export async function testProjectTrackerConnection(
  providerId: string,
  project: Project,
  env: Record<string, string>,
  bodyData: Record<string, unknown>,
  repositoryPath: string,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<TrackerTestResult> {
  const provider = registry.get(providerId);
  if (!provider) {
    return { ok: false, error: `Unsupported provider: ${providerId}` };
  }

  const connection = findConnectionForRole(project, "tracker", registry);
  const base = connection?.providerId === providerId ? connection.config : {};

  const overlay: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(bodyData)) {
    if (key === "provider" || value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    overlay[key] = value;
  }
  for (const [name, value] of Object.entries(
    secretBodyValues(provider, bodyData),
  )) {
    overlay[name] = value;
  }

  const config: ProviderConfig = {
    ...mergeStoredSecrets(provider, base, env),
    ...overlay,
  };

  const check = parseProviderConfig(provider.configSchema, config);
  if (!check.ok) {
    return {
      ok: false,
      error: "Connection settings are incomplete or invalid.",
    };
  }

  // Secret values never leave this function: a provider's failure text can echo
  // a token, so every stored or supplied secret is masked from the message.
  const secretValues = secretRoutesOf(provider)
    .map((route) => config[route.name])
    .filter(
      (value): value is string => typeof value === "string" && value !== "",
    );
  try {
    await provider.verifyCredentials({ ...config, cwd: repositoryPath });
    return {
      ok: true,
      message: `${provider.displayName} connection successful.`,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      error: redactValues((err as Error).message, secretValues),
    };
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
