// src/services/project-creation.ts — Project creation and connection updates
// from the normalized connections payload (#131/#145).
//
// Persistence-only by construction: this module never executes a workflow and
// never calls a provider capability. It validates the complete request in
// memory, writes the secrets to per-project env storage first (idempotent), and
// commits the project record last — a crash before the commit leaves only a
// benign orphaned env file, and a project can never exist without its secrets.
//
// Layering (all before any write): transport shape (zod, in the controller) →
// provider config schema → role/capability compatibility → duplicate id →
// persistence. Codes only — messages never cross the API boundary.

import path from "node:path";
import {
  appendProjectRecord,
  getProjectsConfigPath,
  loadProjects,
  saveProject,
} from "../config.js";
import type {
  ConnectionsProjectInput,
  ProjectConnectionInput,
} from "../config-schema.js";
import { emitStructuredLog } from "../diagnostics/correlation.js";
import { ConflictError, SemanticValidationError } from "../errors.js";
import {
  deleteProjectEnvKeys,
  loadProjectEnv,
  saveProjectEnv,
} from "../project-env.js";
import { parseProviderConfig } from "../providers/config-validation.js";
import {
  hasCapability,
  type Provider,
  type ProviderCapability,
  type ProviderRole,
} from "../providers/contract.js";
import { deriveIssueTracker } from "../providers/project-config.js";
import { redactConnections } from "../providers/redaction.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import {
  getSecretFieldRoutes,
  routeConnectionSecrets,
} from "../providers/secret-routing.js";
import type {
  GitIdentity,
  Project,
  ProjectConnection,
  ProjectRepository,
} from "../types.js";

/** Capabilities a connection must support for each role it declares. */
const ROLE_CAPABILITIES: Record<ProviderRole, readonly ProviderCapability[]> = {
  tracker: ["listTickets"],
  gitHost: ["listRepositories", "createPullRequest", "findExistingPullRequest"],
};

/** 409 `formErrors` code for a role/capability or connection-shape mismatch. */
function incompatibleConfiguration(): SemanticValidationError {
  return new SemanticValidationError({
    formErrors: ["INCOMPATIBLE_CONFIGURATION"],
  });
}

export interface ProjectCreationOptions {
  /** Injected provider registry (tests); defaults to the static registry. */
  registry?: ProviderRegistry;
  /** Projects config file; defaults to the documented path override. */
  configPath?: string;
}

interface PreparedConnection {
  providerId: string;
  roles: ProviderRole[];
  /** Secret-free connection as persisted on the project record. */
  connection: ProjectConnection;
  /** Non-empty secret values keyed by their declared envKey. */
  secrets: Record<string, string>;
}

/** Asserts that a provider can serve a role, via `hasCapability` only. */
function assertRoleCompatible(provider: Provider, role: ProviderRole): void {
  if (!provider.roles.includes(role)) {
    throw incompatibleConfiguration();
  }
  for (const capability of ROLE_CAPABILITIES[role]) {
    if (!hasCapability(provider, capability)) {
      throw incompatibleConfiguration();
    }
  }
}

/**
 * Rejects two connections of the same provider: a dual-role provider carries
 * both roles on ONE connection, and two connections would collide on the same
 * env keys with no way to tell the values apart (no silent merges, #128).
 */
function assertDistinctProviders(providerIds: readonly string[]): void {
  const seen = new Set<string>();
  for (const providerId of providerIds) {
    if (seen.has(providerId)) {
      throw incompatibleConfiguration();
    }
    seen.add(providerId);
  }
}

/**
 * Validates one incoming connection and splits it into what is persisted and
 * what is routed to env storage.
 */
function prepareConnection(
  input: ProjectConnectionInput,
  registry: ProviderRegistry,
): PreparedConnection {
  const provider = registry.get(input.providerId);
  if (!provider) {
    throw new SemanticValidationError({ formErrors: ["UNKNOWN_PROVIDER"] });
  }

  const parsed = parseProviderConfig(provider.configSchema, input.config);
  if (!parsed.ok) {
    throw new SemanticValidationError({ fieldErrors: parsed.fieldErrors });
  }

  const roles = [...new Set<ProviderRole>(input.roles)];
  for (const role of roles) {
    assertRoleCompatible(provider, role);
  }

  const { config, secrets } = routeConnectionSecrets(
    provider.configSchema,
    parsed.config,
  );

  return {
    providerId: provider.id,
    roles,
    connection: { providerId: provider.id, roles, config },
    secrets,
  };
}

/**
 * Merges the routed secrets of every connection. Distinct providers declaring
 * the same env key with different values is a configuration conflict, never a
 * silent overwrite.
 */
function mergeConnectionSecrets(
  prepared: readonly PreparedConnection[],
): Record<string, string> {
  const secrets: Record<string, string> = {};
  for (const connection of prepared) {
    for (const [envKey, value] of Object.entries(connection.secrets)) {
      if (secrets[envKey] !== undefined && secrets[envKey] !== value) {
        throw incompatibleConfiguration();
      }
      secrets[envKey] = value;
    }
  }
  return secrets;
}

interface BuiltRepository {
  repository: ProjectRepository;
  primary: boolean;
}

function buildRepositories(input: ConnectionsProjectInput): BuiltRepository[] {
  return input.repositories.map((discovered) => {
    const localPath = discovered.localPath ?? discovered.name;
    const repositoryPath = input.workspacePath
      ? path.resolve(input.workspacePath, localPath)
      : path.resolve(localPath);

    return {
      repository: {
        id: discovered.id,
        name: discovered.name,
        remote: discovered.remote,
        path: repositoryPath,
        defaultBranch: discovered.defaultBranch?.trim() || "main",
        role: discovered.role ?? "other",
      },
      primary: discovered.primary === true,
    };
  });
}

/**
 * Builds the project record: the normalized connections plus every legacy field
 * the runtime still resolves (issueTracker, repositoryPath, defaultBranch,
 * testCommand), so queue/deliver/readiness keep working unchanged.
 *
 * The legacy `issueTracker` mirror is written on EVERY new record on purpose
 * (#145): the queue, delivery and readiness runtime still resolves a project's
 * tracker through that legacy view, and #133 leaves legacy config migration an
 * open question, so the mirror is what keeps the pre-#145 runtime working for a
 * #145-created project. It is always DERIVED from the tracker connection
 * (`deriveIssueTracker`), never supplied, and never the default: a payload with
 * no tracker-role connection is rejected below, because both connections are
 * mandatory at creation (#133).
 */
function buildProjectRecord(
  input: ConnectionsProjectInput,
  prepared: readonly PreparedConnection[],
): Project {
  const built = buildRepositories(input);
  const primary = built.find((r) => r.primary) ?? built[0];
  if (!primary) {
    // The transport schema already requires at least one repository.
    throw incompatibleConfiguration();
  }

  const trackerConnection = prepared.find((c) => c.roles.includes("tracker"));
  if (!trackerConnection) {
    throw new SemanticValidationError({
      formErrors: ["MISSING_TRACKER_CONNECTION"],
    });
  }

  const issueTracker = deriveIssueTracker(
    trackerConnection.providerId,
    trackerConnection.connection.config,
  );

  return {
    id: input.id,
    name: input.name,
    workspacePath: input.workspacePath,
    commandTimeoutMs: input.commandTimeoutMs,
    archived: input.archived,
    gitIdentity: input.gitIdentity,
    issueTracker,
    connections: prepared.map((c) => c.connection),
    repositories: built.map((b) => b.repository),
    repositoryPath: primary.repository.path,
    defaultBranch: primary.repository.defaultBranch,
    testCommand: primary.repository.commands?.test || "",
  };
}

/**
 * Creates a project from the normalized connections payload (#131).
 *
 * Ordered writes: validate everything in memory → write the secrets (idempotent,
 * so a retry after a partial failure converges) → append the project record as
 * the commit point. If secret persistence fails, no project is created.
 */
export async function createProjectFromConnections(
  input: ConnectionsProjectInput,
  options: ProjectCreationOptions = {},
): Promise<Project> {
  const registry = options.registry ?? PROVIDER_REGISTRY;
  const configPath = options.configPath ?? getProjectsConfigPath();

  // (1) Validate the complete request in memory, before any write.
  assertDistinctProviders(input.connections.map((c) => c.providerId));
  const prepared = input.connections.map((connection) =>
    prepareConnection(connection, registry),
  );
  const secrets = mergeConnectionSecrets(prepared);
  const record = buildProjectRecord(input, prepared);

  const existing = await loadProjects(configPath);
  if (existing.some((p) => p.id === input.id)) {
    throw new ConflictError(`Project with ID "${input.id}" already exists.`);
  }

  // (2) Secrets first — overwriting is safe, so a retry converges.
  await saveProjectEnv(input.id, secrets);

  // (3) The project record is the commit point.
  const saved = await appendProjectRecord(record, configPath);

  emitStructuredLog(
    "info",
    "Project created from connections",
    {},
    {
      project_id: saved.id,
      // Redaction before serialization: the incoming configuration is logged
      // with every declared secret masked, never as received.
      connections: redactConnections(input.connections, registry),
    },
  );

  return saved;
}

/** One connection in a project update; its secret values are optional. */
export interface ProjectConnectionUpdate {
  providerId: string;
  roles: ProviderRole[];
  config: Record<string, unknown>;
}

export interface UpdateProjectConnectionsInput {
  name?: string | undefined;
  workspacePath?: string | undefined;
  gitIdentity?: GitIdentity | undefined;
  connections: ProjectConnectionUpdate[];
  /** Secret field names to clear, applied before validation (#131). */
  clearSecrets?: string[] | undefined;
}

interface PreparedConnectionUpdate {
  connection: ProjectConnection;
  secrets: Record<string, string>;
  clearedKeys: string[];
}

/**
 * Applies `clearSecrets` (before validation), overlays the request's non-secret
 * configuration on the stored connection, keeps stored secrets that were not
 * replaced or cleared, and validates the result against the provider schema.
 */
function prepareConnectionUpdate(
  project: Project,
  input: ProjectConnectionUpdate,
  clearSecrets: readonly string[],
  storedEnv: Record<string, string>,
  registry: ProviderRegistry,
): PreparedConnectionUpdate {
  const provider = registry.get(input.providerId);
  if (!provider) {
    throw new SemanticValidationError({ formErrors: ["UNKNOWN_PROVIDER"] });
  }

  const roles = [...new Set<ProviderRole>(input.roles)];
  for (const role of roles) {
    assertRoleCompatible(provider, role);
  }

  const routes = getSecretFieldRoutes(provider.configSchema);
  const secretNames = new Set(routes.map((route) => route.name));

  const existing = project.connections?.find(
    (connection) => connection.providerId === provider.id,
  );
  const effective: Record<string, unknown> = { ...(existing?.config ?? {}) };

  for (const [key, value] of Object.entries(input.config)) {
    if (value === undefined || secretNames.has(key)) continue;
    effective[key] = value;
  }

  const clearedKeys: string[] = [];
  for (const route of routes) {
    if (clearSecrets.includes(route.name)) {
      delete effective[route.name];
      clearedKeys.push(route.envKey);
      continue;
    }
    const provided = input.config[route.name];
    if (typeof provided === "string" && provided.trim().length > 0) {
      effective[route.name] = provided.trim();
      continue;
    }
    // Missing or empty means keep: reuse the stored secret, never delete it.
    const stored = storedEnv[route.envKey];
    if (stored) {
      effective[route.name] = stored;
    } else {
      delete effective[route.name];
    }
  }

  const parsed = parseProviderConfig(provider.configSchema, effective);
  if (!parsed.ok) {
    throw new SemanticValidationError({ fieldErrors: parsed.fieldErrors });
  }

  const routed = routeConnectionSecrets(provider.configSchema, parsed.config);

  return {
    connection: { providerId: provider.id, roles, config: routed.config },
    secrets: routed.secrets,
    clearedKeys,
  };
}

/** Replaces the updated provider connections in place, appending new ones. */
function mergeConnections(
  existing: readonly ProjectConnection[] | undefined,
  updates: readonly ProjectConnection[],
): ProjectConnection[] {
  const merged = [...(existing ?? [])];
  for (const update of updates) {
    const index = merged.findIndex((c) => c.providerId === update.providerId);
    if (index >= 0) merged[index] = update;
    else merged.push(update);
  }
  return merged;
}

/**
 * Updates project connections and their secrets.
 *
 * `clearSecrets` is applied before validation; a missing or empty secret means
 * keep (an empty string never means delete); clearing a required secret fails
 * with `fieldErrors`. Secrets are written first, the project record last.
 */
export async function updateProjectConnections(
  project: Project,
  input: UpdateProjectConnectionsInput,
  options: ProjectCreationOptions = {},
): Promise<Project> {
  const registry = options.registry ?? PROVIDER_REGISTRY;
  const configPath = options.configPath ?? getProjectsConfigPath();
  const clearSecrets = input.clearSecrets ?? [];

  assertDistinctProviders(input.connections.map((c) => c.providerId));

  if (clearSecrets.length > 0) {
    const declared = new Set<string>();
    for (const connection of input.connections) {
      const provider = registry.get(connection.providerId);
      if (!provider) continue;
      for (const route of getSecretFieldRoutes(provider.configSchema)) {
        declared.add(route.name);
      }
    }
    const unknown = clearSecrets.filter((name) => !declared.has(name));
    if (unknown.length > 0) {
      throw new SemanticValidationError({
        fieldErrors: Object.fromEntries(
          unknown.map((name) => [name, "INVALID"]),
        ),
      });
    }
  }

  const storedEnv = await loadProjectEnv(project.id);
  const updates = input.connections.map((connection) =>
    prepareConnectionUpdate(
      project,
      connection,
      clearSecrets,
      storedEnv,
      registry,
    ),
  );

  const secrets: Record<string, string> = {};
  const clearedKeys: string[] = [];
  for (const update of updates) {
    Object.assign(secrets, update.secrets);
    clearedKeys.push(...update.clearedKeys);
  }

  // Secrets first (idempotent), then the record as the commit point.
  await saveProjectEnv(project.id, secrets);
  await deleteProjectEnvKeys(project.id, clearedKeys);

  const connections = mergeConnections(
    project.connections,
    updates.map((update) => update.connection),
  );
  const trackerConnection = connections.find((c) =>
    c.roles.includes("tracker"),
  );

  const next: Project = {
    ...project,
    name: input.name?.trim() || project.name,
    workspacePath: input.workspacePath?.trim() || project.workspacePath,
    gitIdentity: input.gitIdentity ?? project.gitIdentity,
    connections,
    issueTracker: trackerConnection
      ? deriveIssueTracker(
          trackerConnection.providerId,
          trackerConnection.config,
        )
      : project.issueTracker,
  };

  const saved = await saveProject(next, configPath);

  emitStructuredLog(
    "info",
    "Project connections updated",
    {},
    {
      project_id: saved.id,
      // Redacted before serialization, as on creation.
      connections: redactConnections(input.connections, registry),
    },
  );

  return saved;
}
