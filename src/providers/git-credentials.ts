// src/providers/git-credentials.ts — The git credentials a project's git-host connection gives for a remote.

import { loadProjectEnv } from "../project-env.js";
import type { Project } from "../shared/types.js";
import { type GitCredentials, hasCapability } from "./contract.js";
import { resolveProjectConnection } from "./project-connections.js";
import { PROVIDER_REGISTRY, type ProviderRegistry } from "./registry.js";

/**
 * The credentials the project's git host gives for `remote`, or `undefined`
 * when it gives none (no connection, no `gitCredentials` capability, no token,
 * or another host): git then uses this machine's own credentials. Never throws.
 */
export async function resolveGitCredentials(
  project: Project,
  remote: string | null | undefined,
  registry: ProviderRegistry = PROVIDER_REGISTRY,
): Promise<GitCredentials | undefined> {
  if (!remote) return undefined;
  try {
    const env = await loadProjectEnv(project.id);
    const connection = resolveProjectConnection(
      project,
      "gitHost",
      env,
      registry,
    );
    if (!connection || !hasCapability(connection.provider, "gitCredentials")) {
      return undefined;
    }
    return (
      connection.provider.gitCredentials(connection.config, remote) ?? undefined
    );
  } catch {
    return undefined;
  }
}
