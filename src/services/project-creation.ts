// src/services/project-creation.ts — Project creation and connection updates
// from the normalized connections payload (#131/#145).
//
// Persistence-only by construction: this module never executes a workflow and
// never calls a provider capability. It validates the complete request in
// memory, writes the secrets to per-project env storage first (idempotent), and
// commits the project record last — a crash before the commit leaves only a
// benign orphaned env file, and a project can never exist without its secrets.
//
// Both paths run the ONE connection-set write plan (#187, see
// `connection-write-plan.ts`): validate → route secrets → role coverage → env
// writes/deletes → record, with replace and remove semantics on update. The
// record store and env store are injectable together through
// `options.store`.
//
// Layering (all before any write): transport shape (zod, in the controller) →
// provider config schema → role/capability compatibility → required-role
// coverage → duplicate id → persistence. Codes only — messages never cross the
// API boundary.

import path from "node:path";
import {
  type ConnectionsProjectInput,
  MISSING_CONNECTION_ROLE_CODES,
  type ProjectConnectionInput,
} from "../config-schema.js";
import { emitStructuredLog } from "../diagnostics/correlation.js";
import {
  ConflictError,
  NotFoundError,
  SemanticValidationError,
} from "../errors.js";
import { getProjectsConfigPath } from "../paths.js";
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
import type {
  GitIdentity,
  Project,
  ProjectConnection,
  ProjectRepository,
} from "../types.js";
import {
  applyConnectionSetPlan,
  FILE_PROJECT_WRITE_STORE,
  incompatibleConfiguration,
  type PreparedConnection,
  type ProjectWriteStore,
  planConnectionSetWrite,
  removedConnectionEnvKeys,
} from "./connection-write-plan.js";
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

export interface ProjectCreationOptions {
  /** Injected provider registry (tests); defaults to the static registry. */
  registry?: ProviderRegistry;
  /** Projects config file; defaults to the documented path override. */
  configPath?: string;
  /** Creation-claim tuning (tests); defaults to the documented TTL and bound. */
  claim?: CreationClaimOptions;
  /**
   * The record store and env store, injectable together as one store (#187);
   * defaults to the shipped file-backed store.
   */
  store?: ProjectWriteStore;
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
  const store = options.store ?? FILE_PROJECT_WRITE_STORE;

  // (1) Validate the complete request in memory, before any write. Pure, so it
  // stays outside the claim: an invalid payload must not contend for one.
  assertDistinctProviders(input.connections.map((c) => c.providerId));
  const prepared = input.connections.map((connection) =>
    prepareConnection(connection, registry),
  );
  // Both roles must be covered, and the secrets conflict-free, before ANY
  // write: the shared plan (#187) rejects a set that will never be written — a
  // tracker-only or git-host-only connection set, or two providers claiming
  // the same env key with different values, must never reach the secret store.
  const plan = planConnectionSetWrite(prepared);
  const record = buildProjectRecord(input, prepared, plan.coverage.tracker);

  try {
    return await withCreationClaim(
      input.id,
      async (claim) => {
        // (2) The duplicate check runs inside the claim, so "no project with
        // this id exists" keeps holding for the whole write sequence below.
        const existing = await store.loadProjects(configPath);
        if (existing.some((p) => p.id === input.id)) {
          throw new ConflictError(
            `Project with ID "${input.id}" already exists.`,
          );
        }

        // (3)+(4) The shared write plan (#187): secrets first — overwriting is
        // safe, so a retry converges — then the project record as the commit
        // point, with a fencing check before each write.
        const saved = await applyConnectionSetPlan({
          store,
          projectId: input.id,
          plan,
          writeRecord: () => store.appendProjectRecord(record, configPath),
          claim,
        });

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

/**
 * Updates project connections and their secrets, through the shared write plan
 * (#187): the request's `connections` REPLACE the stored set wholesale, and the
 * env entries of connections it does not name are REMOVED, so swapping a
 * project's connections works.
 *
 * `clearSecrets` is applied before validation; a missing or empty secret means
 * keep (an empty string never means delete); clearing a required secret fails
 * with `fieldErrors`. The REPLACEMENT connection set is then checked for
 * required role coverage and env-key conflicts — an update that would leave
 * the project without a tracker or without a git host, or that declares the
 * same env key on two providers with different values, is rejected with
 * `formErrors` before any secret is written. Secrets are written first, the
 * project record last.
 */
async function updateProjectConnectionsInternal(
  project: Project,
  input: UpdateProjectConnectionsInput,
  options: ProjectCreationOptions = {},
  claim?: CreationClaim,
): Promise<Project> {
  const registry = options.registry ?? PROVIDER_REGISTRY;
  const configPath = options.configPath ?? getProjectsConfigPath();
  const store = options.store ?? FILE_PROJECT_WRITE_STORE;
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
  const storedEnv = await store.loadProjectEnv(project.id);

  // Prepare the REPLACEMENT set: each incoming connection replaces a stored
  // connection of the same provider, keeping stored secrets that were not
  // replaced or cleared.
  const updates = input.connections.map((connection) =>
    prepareConnectionUpdate(
      project,
      connection,
      clearSecrets,
      storedEnv,
      registry,
    ),
  );
  const prepared: PreparedConnection[] = updates.map((update) => ({
    providerId: update.connection.providerId,
    roles: update.connection.roles,
    connection: update.connection,
    secrets: update.secrets,
  }));
  // Replace AND remove (#187): the request's connections are the complete new
  // set — the stored set is NOT merged into it — and the env entries owned by
  // the connections it drops (plus the explicitly cleared keys) are deleted
  // after the secrets are written.
  const plan = planConnectionSetWrite(prepared, [
    ...updates.flatMap((update) => update.clearedKeys),
    ...removedConnectionEnvKeys(project.connections, prepared, registry),
  ]);

  // Save updated project record
  const next: Project = {
    ...project,
    name: input.name?.trim() || project.name,
    workspacePath: input.workspacePath?.trim() || project.workspacePath,
    gitIdentity: input.gitIdentity ?? project.gitIdentity,
    connections: plan.connections,
    issueTracker: deriveIssueTracker(
      plan.coverage.tracker.providerId,
      plan.coverage.tracker.connection.config,
    ),
  };

  const saved = await applyConnectionSetPlan({
    store,
    projectId: project.id,
    plan,
    writeRecord: () => store.saveProject(next, configPath),
    claim,
  });

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
  const store = options.store ?? FILE_PROJECT_WRITE_STORE;

  try {
    return await withCreationClaim(
      projectId,
      async (claim) => {
        // Critical: fresh read INSIDE the claim.
        const project = await store.getProject(projectId, false, configPath);

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
