// src/providers/project-config.ts — Project tracker operations (#141, #172).
//
// Every operation here resolves its connection through the project connections
// module and reads secret field names and env keys from the provider schema.
// No provider is named in this file.

import { maskSecret } from "../settings.js";
import type {
  IssueTrackerProvider,
  Project,
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
  const varsToSave: Record<string, string> = {};
  for (const route of secretRoutesOf(provider)) {
    const value = secretBodyValues(provider, body)[route.name];
    if (value !== undefined) varsToSave[route.envKey] = value;
  }
  return varsToSave;
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

  try {
    await provider.verifyCredentials({ ...config, cwd: repositoryPath });
    return {
      ok: true,
      message: `${provider.displayName} connection successful.`,
    };
  } catch (err: unknown) {
    return { ok: false, error: (err as Error).message };
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
        project: string;
        requiredLabel?: string | undefined;
      }
    | undefined;
  github?: { repo: string; requiredLabel?: string | undefined } | undefined;
  secrets?: { pat?: string; token?: string } | undefined;
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

  const newProject: Project = {
    ...project,
    id: newId,
    name: body.name?.trim() || project.name,
    issueTracker: newIssueTracker,
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

  return {
    newId,
    newProject,
    archivedOldProject,
    secretsToSave,
  };
}
