// src/services/connection-write-plan.ts — The one connection-set write plan
// shared by project create and update (#187, spec #163 area "Project
// connections and providers").
//
// Both paths run the same ladder over the COMPLETE connection set the request
// produces — the payload's set on create, the replacement set on update:
// required-role coverage → secret merge (env-key conflicts rejected) → env
// writes → the project record as the commit point → env deletes. An update
// REPLACES the stored connection set wholesale and REMOVES the env entries of
// connections it does not name, so swapping a project's connections works.
//
// The project record store and the per-project env store are injectable
// together as ONE store (`ProjectWriteStore`), so tests inject failures
// through the store instead of mutating `process.env` or file permissions.
// The shipped default wraps `src/config.js` and `src/project-env.js`.

import {
  appendProjectRecord,
  getProject,
  loadProjects,
  saveProject,
} from "../config.js";
import { missingConnectionRoleCodes } from "../config-schema.js";
import { SemanticValidationError } from "../errors.js";
import {
  deleteProjectEnvKeys,
  loadProjectEnv,
  saveProjectEnv,
} from "../project-env.js";
import type { ProviderRole } from "../providers/contract.js";
import type { ProviderRegistry } from "../providers/registry.js";
import { getSecretFieldRoutes } from "../providers/secret-routing.js";
import type { Project, ProjectConnection } from "../types.js";
import type { CreationClaim } from "./creation-claim.js";

/**
 * The project record store and the per-project env storage, injectable as one
 * store (#187). The shipped implementation is `FILE_PROJECT_WRITE_STORE`.
 */
export interface ProjectWriteStore {
  loadProjects(configPath?: string): Promise<Project[]>;
  getProject(
    projectId: string,
    validateOnDisk?: boolean,
    configPath?: string,
  ): Promise<Project | null>;
  /** The creation commit point: append a NEW record, rejecting a duplicate id. */
  appendProjectRecord(record: Project, configPath?: string): Promise<Project>;
  /** The update commit point: replace the stored record with this id. */
  saveProject(record: Project, configPath?: string): Promise<Project>;
  loadProjectEnv(projectId: string): Promise<Record<string, string>>;
  saveProjectEnv(
    projectId: string,
    vars: Record<string, string>,
  ): Promise<void>;
  deleteProjectEnvKeys(
    projectId: string,
    keys: readonly string[],
  ): Promise<void>;
}

/** The shipped store: the file-backed record store plus the file-backed env store. */
export const FILE_PROJECT_WRITE_STORE: ProjectWriteStore = {
  loadProjects,
  getProject,
  appendProjectRecord,
  saveProject,
  loadProjectEnv,
  saveProjectEnv,
  deleteProjectEnvKeys,
};

/** 409 `formErrors` code for a role/capability, connection-shape or env-key conflict. */
export function incompatibleConfiguration(): SemanticValidationError {
  return new SemanticValidationError({
    formErrors: ["INCOMPATIBLE_CONFIGURATION"],
  });
}

/** One validated, secret-routed connection in a write plan. */
export interface PreparedConnection {
  providerId: string;
  roles: readonly ProviderRole[];
  /** Secret-free connection as persisted on the project record. */
  connection: ProjectConnection;
  /** Non-empty secret values keyed by their declared envKey. */
  secrets: Record<string, string>;
}

/**
 * The role-coverage gate (#133/CORR-1): a connection set is valid only when it
 * covers BOTH required roles — as two connections, one per role, or as one
 * dual-role connection. It runs inside the PRE-WRITE validation ladder of both
 * creation and update (for an update, against the REPLACEMENT result), so no
 * secret is ever written for a set that will be rejected.
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
 * silent overwrite. Shared by create and update (#187), so both paths reject
 * an env-key conflict the same way.
 */
export function mergeConnectionSecrets(
  prepared: readonly Pick<PreparedConnection, "providerId" | "secrets">[],
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

/**
 * The env keys owned by the connections a REPLACE drops (#187 remove
 * semantics): every secret-route envKey declared by a stored connection whose
 * provider is not in the replacement set. A provider no longer in the
 * registry contributes nothing — its routes cannot be resolved, and guessing
 * key names would risk deleting another provider's secret.
 */
export function removedConnectionEnvKeys(
  existing: readonly ProjectConnection[] | undefined,
  replacement: readonly { providerId: string }[],
  registry: ProviderRegistry,
): string[] {
  const kept = new Set(replacement.map((connection) => connection.providerId));
  const keys: string[] = [];
  for (const connection of existing ?? []) {
    if (kept.has(connection.providerId)) continue;
    const provider = registry.get(connection.providerId);
    if (!provider) continue;
    for (const route of getSecretFieldRoutes(provider.configSchema)) {
      keys.push(route.envKey);
    }
  }
  return keys;
}

/** The validated connection-set write plan: everything decided before any write. */
export interface ConnectionSetPlan {
  /** The complete connection set, as persisted on the project record. */
  connections: ProjectConnection[];
  /** The connection proved to own each required role, by the coverage gate. */
  coverage: { tracker: PreparedConnection; gitHost: PreparedConnection };
  /** Non-empty secret values keyed by envKey; conflicts already rejected. */
  secrets: Record<string, string>;
  /**
   * Env entries to remove AFTER the record commit: dropped connections' keys
   * and explicitly cleared keys, minus any key the plan itself writes (a key
   * reused by the replacement set must survive the removal).
   */
  envKeysToDelete: string[];
}

/**
 * The shared plan step (#187): required-role coverage, then the secret merge
 * with its env-key conflict rejection. Pure — it runs before any write, so a
 * set that will be rejected never writes a secret or contends for a claim.
 */
export function planConnectionSetWrite(
  prepared: readonly PreparedConnection[],
  envKeysToDelete: readonly string[] = [],
): ConnectionSetPlan {
  const coverage = assertConnectionRoleCoverage(prepared);
  const secrets = mergeConnectionSecrets(prepared);
  const written = new Set(Object.keys(secrets));
  return {
    connections: prepared.map((connection) => connection.connection),
    coverage,
    secrets,
    envKeysToDelete: envKeysToDelete.filter((key) => !written.has(key)),
  };
}

/**
 * The shared ordered-write step (#187): fencing → env writes → the project
 * record as the commit point → env deletes. Secrets are written first
 * (idempotent, so a retry converges); the record commits next; the removals
 * run only AFTER a successful commit (they may name a key the secrets just
 * wrote only through another provider, which the plan has already excluded).
 * A crash before the commit leaves at most a benign orphaned env entry, and a
 * project can never exist without its secrets; a crash between the commit and
 * the deletes leaves at most harmless orphaned env keys — a committed record
 * never references a connection whose secrets were already removed.
 */
export async function applyConnectionSetPlan(args: {
  store: ProjectWriteStore;
  projectId: string;
  plan: ConnectionSetPlan;
  /** The record write — the plan's commit point (append on create, save on update). */
  writeRecord: () => Promise<Project>;
  claim?: CreationClaim | undefined;
}): Promise<Project> {
  // Fencing check: the claim must still be held before any write.
  if (args.claim) {
    await args.claim.assertHeld();
  }

  await args.store.saveProjectEnv(args.projectId, args.plan.secrets);

  // Fencing check: verify the claim is still held before the commit point.
  if (args.claim) {
    await args.claim.assertHeld();
  }

  const saved = await args.writeRecord();

  // Removals run only AFTER the commit succeeds: a committed record never
  // loses the secrets it references, and a crash here leaves at most harmless
  // orphaned env keys.
  await args.store.deleteProjectEnvKeys(
    args.projectId,
    args.plan.envKeysToDelete,
  );

  return saved;
}
