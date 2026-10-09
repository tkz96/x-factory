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
// provider config schema → role/capability compatibility → required-role
// coverage → duplicate id → persistence. Codes only — messages never cross the
// API boundary.

import path from "node:path";
import {
  appendProjectRecord,
  getProject,
  loadProjects,
  saveProject,
} from "../config.js";
import {
  type ConnectionsProjectInput,
  MISSING_CONNECTION_ROLE_CODES,
  missingConnectionRoleCodes,
  type ProjectConnectionInput,
} from "../config-schema.js";
import {
  ConflictError,
  NotFoundError,
  SemanticValidationError,
} from "../errors.js";
import { getProjectsConfigPath } from "../paths.js";
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
import { registryTrackerProviderId } from "../providers/project-connections.js";
import { redactConnections } from "../providers/redaction.js";
import {
  PROVIDER_REGISTRY,
  type ProviderRegistry,
} from "../providers/registry.js";
import {
  getSecretFieldRoutes,
  routeConnectionSecrets,
} from "../providers/secret-routing.js";
import { emitStructuredLog } from "../shared/correlation.js";
import type {
  GitIdentity,
  Project,
  ProjectConnection,
  ProjectRepository,
} from "../types.js";
import {
  type CreationClaim,
  type CreationClaimOptions,
  translateClaimError,
  withCreationClaim,
} from "./creation-claim.js";

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
  /** Creation-claim tuning (tests); defaults to the documented TTL and bound. */
  claim?: CreationClaimOptions;
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
 * The role-coverage gate (#133/CORR-1): a connection set is valid only when it
 * covers BOTH required roles — as two connections, one per role, or as one
 * dual-role connection. It runs inside the PRE-WRITE validation ladder of both
 * creation and update (for an update, against the MERGED result), so no secret
 * is ever written for a set that will be rejected.
 *
 * Each required role must have exactly one owner (#133 / PR #158 Task 1). If a
 * required role is covered by more than one connection, it is rejected with
 * `incompatibleConfiguration()`. If a required role is missing, it is rejected
 * with `missingConnectionRoleCodes(connections)`.
 *
 * It returns the connection carrying each role, so the record builder derives
 * the legacy tracker mirror from the same lookup that proved the role exists —
 * never from a second, weaker check.
 */
export function assertConnectionRoleCoverage<
  T extends { roles: readonly ProviderRole[] },
>(connections: readonly T[]): { tracker: T; gitHost: T } {
  const trackerOwners = connections.filter((connection) =>
    connection.roles.includes("tracker"),
  );
  const gitHostOwners = connections.filter((connection) =>
    connection.roles.includes("gitHost"),
  );

  if (trackerOwners.length === 0 || gitHostOwners.length === 0) {
    throw new SemanticValidationError({
      formErrors: missingConnectionRoleCodes(connections),
    });
  }

  // Exactly one connection must own each required role.
  // One connection may own both roles.
  if (trackerOwners.length !== 1 || gitHostOwners.length !== 1) {
    throw incompatibleConfiguration();
  }

  const tracker = trackerOwners[0];
  const gitHost = gitHostOwners[0];
  if (!tracker || !gitHost) {
    throw incompatibleConfiguration();
  }

  return { tracker, gitHost };
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
 * (`deriveIssueTracker`), never supplied, and never the default.
 *
 * `trackerConnection` is the carrier the role-coverage gate already proved
 * exists (#133): both connections are mandatory at creation, so this builder
 * has no "no tracker" branch to fall back to — the gate rejects such a payload
 * before any write.
 */
function buildProjectRecord(
  input: ConnectionsProjectInput,
  prepared: readonly PreparedConnection[],
  trackerConnection: PreparedConnection,
): Project {
  const built = buildRepositories(input);
  const primary = built.find((r) => r.primary) ?? built[0];
  if (!primary) {
    // The transport schema already requires at least one repository.
    throw incompatibleConfiguration();
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
 * The LEGACY create path's tracker gate (#133 correction 1).
 *
 * The connection-array form of the role-coverage rule (`assertConnectionRoleCoverage`)
 * cannot apply to a legacy payload: a legacy record carries no `connections`
 * array, because its git host IS its repository — `repositoryPath` plus that
 * repository's remote — and its tracker is a single `issueTracker` view. What
 * DOES apply, unchanged, is the requirement that a created project be
 * operable: the tracker it names must be one the registry can serve for the
 * tracker role, so a payload that names none is rejected here, before any write,
 * with the same code the connections branch reports.
 *
 * Provider-agnostic: the id comes from `registryTrackerProviderId`, and the checks
 * are the registry's (`get` + role + capability), never a name.
 */
export function assertLegacyTrackerUsable(
  issueTracker: unknown,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): void {
  const providerId = registryTrackerProviderId(issueTracker, registry);
  if (providerId === null) {
    throw new SemanticValidationError({
      formErrors: [MISSING_CONNECTION_ROLE_CODES.tracker],
    });
  }
  const provider = registry.get(providerId);
  if (!provider) {
    throw new SemanticValidationError({ formErrors: ["UNKNOWN_PROVIDER"] });
  }
  assertRoleCompatible(provider, "tracker");
}

/**
 * Creates a project from the normalized connections payload (#131).
 *
 * Ordered writes, INSIDE the per-id creation claim (see
 * `src/services/creation-claim.ts`): claim → duplicate check → secrets
 * (idempotent, so a retry after a partial failure converges) → project record as
 * the commit point → release. If secret persistence fails, no project is
 * created.
 *
 * The claim is what makes this sequence safe against a concurrent creation of
 * the SAME id: without it, two creations both pass an in-memory duplicate check,
 * both write secrets, and only then does one of them lose the record append —
 * leaving the winner's secret overwritten by the loser's values. With it, the
 * loser writes nothing: it waits for the winner's claim and is rejected by the
 * duplicate check, which runs *inside* the claim, as the same 409
 * `ConflictError` as before.
 */
export async function createProjectFromConnections(
  input: ConnectionsProjectInput,
  options: ProjectCreationOptions = {},
): Promise<Project> {
  const registry = options.registry ?? PROVIDER_REGISTRY;
  const configPath = options.configPath ?? getProjectsConfigPath();

  // (1) Validate the complete request in memory, before any write. Pure, so it
  // stays outside the claim: an invalid payload must not contend for one.
  assertDistinctProviders(input.connections.map((c) => c.providerId));
  const prepared = input.connections.map((connection) =>
    prepareConnection(connection, registry),
  );
  // Both roles must be covered before ANY write: a tracker-only or git-host-only
  // connection set must never reach the secret store (#133).
  const coverage = assertConnectionRoleCoverage(prepared);
  const secrets = mergeConnectionSecrets(prepared);
  const record = buildProjectRecord(input, prepared, coverage.tracker);

  try {
    return await withCreationClaim(
      input.id,
      async (claim) => {
        // (2) The duplicate check runs inside the claim, so "no project with
        // this id exists" keeps holding for the whole write sequence below.
        const existing = await loadProjects(configPath);
        if (existing.some((p) => p.id === input.id)) {
          throw new ConflictError(
            `Project with ID "${input.id}" already exists.`,
          );
        }

        // Fencing check: verify claim is still held before mutating secret store.
        await claim.assertHeld();

        // (3) Secrets first — overwriting is safe, so a retry converges.
        await saveProjectEnv(input.id, secrets);

        // Fencing check: verify claim is still held before committing project record.
        await claim.assertHeld();

        // (4) The project record is the commit point.
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
      },
      options.claim,
    );
  } catch (err) {
    // A claim not taken within the wait bound means another creation of this id
    // is in flight; a lost claim means another creation took over. Both map to
    // ConflictError (HTTP 409).
    translateClaimError(err, input.id);
  }
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

  const clearSecretNames = new Set(clearSecrets);
  const clearedKeys: string[] = [];
  for (const route of routes) {
    if (clearSecretNames.has(route.name)) {
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
 * with `fieldErrors`. The MERGED connection set is then checked for required
 * role coverage — an update that would leave the project without a tracker or
 * without a git host is rejected with `formErrors` before any secret is
 * written. Secrets are written first, the project record last.
 */
async function updateProjectConnectionsInternal(
  project: Project,
  input: UpdateProjectConnectionsInput,
  options: ProjectCreationOptions = {},
  claim?: CreationClaim,
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

  // Perform fencing check: verify claim is still held before reading env
  if (claim) {
    await claim.assertHeld();
  }

  // Load latest project env
  const storedEnv = await loadProjectEnv(project.id);

  // Prepare updates and merge with current connections
  const updates = input.connections.map((connection) =>
    prepareConnectionUpdate(
      project,
      connection,
      clearSecrets,
      storedEnv,
      registry,
    ),
  );
  const connections = mergeConnections(
    project.connections,
    updates.map((update) => update.connection),
  );

  // Validate merged role coverage
  const coverage = assertConnectionRoleCoverage(connections);

  const secrets: Record<string, string> = {};
  const clearedKeys: string[] = [];
  for (const update of updates) {
    Object.assign(secrets, update.secrets);
    clearedKeys.push(...update.clearedKeys);
  }

  // Save secrets and delete cleared keys
  await saveProjectEnv(project.id, secrets);
  await deleteProjectEnvKeys(project.id, clearedKeys);

  // Perform fencing check: verify claim is still held before committing project record
  if (claim) {
    await claim.assertHeld();
  }

  // Save updated project record
  const next: Project = {
    ...project,
    name: input.name?.trim() || project.name,
    workspacePath: input.workspacePath?.trim() || project.workspacePath,
    gitIdentity: input.gitIdentity ?? project.gitIdentity,
    connections,
    issueTracker: deriveIssueTracker(
      coverage.tracker.providerId,
      coverage.tracker.config,
    ),
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

export async function updateProjectConnectionsById(
  projectId: string,
  input: UpdateProjectConnectionsInput,
  options: ProjectCreationOptions = {},
): Promise<Project> {
  const configPath = options.configPath ?? getProjectsConfigPath();

  try {
    return await withCreationClaim(
      projectId,
      async (claim) => {
        // Critical: fresh read INSIDE the claim.
        const project = await getProject(projectId, false, configPath);

        if (!project) {
          throw new NotFoundError(`Project "${projectId}" not found.`);
        }

        return updateProjectConnectionsInternal(project, input, options, claim);
      },
      options.claim,
    );
  } catch (err) {
    translateClaimError(err, projectId);
  }
}

export async function updateProjectConnections(
  project: Project,
  input: UpdateProjectConnectionsInput,
  options: ProjectCreationOptions = {},
): Promise<Project> {
  return updateProjectConnectionsById(project.id, input, options);
}
