// src/frontend/wizard/steps/reviewPayload.ts — Builds the project creation
// payload from the wizard's IN-MEMORY state (spec #133, #131, ticket #146).
//
// Read from the live wizard state, never from the sanitized draft: this is the
// one place a secret travels, inline in each connection's config, exactly once
// (#131). The builder is pure, so the payload contract is testable without a
// render.
//
// Roles: a connection's `roles` array carries every role the ONE connection
// serves, so a dual-role provider appears once — the server rejects two
// connections of the same provider (#145). A repository's `role` is the
// payload's RepositoryRole tag; the connection role a repository was listed
// under ("gitHost") is NOT one of those, so it is never sent as one.

import type { GitIdentity } from "../../../shared/types.js";
import type {
  ProjectCreationPayload,
  ProjectCreationRepositoryPayload,
} from "../../lib/api-client.js";
import type { WizardSourceState } from "../types.js";

/**
 * The repository roles the creation contract accepts, mirrored from the
 * server's `VALID_ROLES` (`src/config-schema.ts`) — the frontend never imports
 * provider or server modules. Kept in sync by `test/review-step.test.tsx`,
 * which validates the built payload against the server's own schema.
 */
const REPOSITORY_ROLES = [
  "frontend",
  "backend",
  "service",
  "worker",
  "mobile",
  "infrastructure",
  "documentation",
  "knowledge",
  "other",
] as const;

/** The repository detail discovery reported, used to name what was selected. */
export interface DiscoveredRepositoryDetail {
  id: string;
  name: string;
  remote?: string | undefined;
  defaultBranch?: string | undefined;
}

function repositoryRole(config: {
  role?: string | undefined;
}): string | undefined {
  const role = config.role;
  return role !== undefined &&
    (REPOSITORY_ROLES as readonly string[]).includes(role)
    ? role
    : undefined;
}

/**
 * Builds the creation payload. The connection config comes from the git-host
 * card when the provider serves that role (the repository list was discovered
 * with it), otherwise from the tracker card.
 *
 * The identity is a required argument rather than read from state: the payload
 * cannot be built without one, and the contract has no room for a placeholder.
 */
export function buildCreationPayload(
  state: WizardSourceState,
  discovered: readonly DiscoveredRepositoryDetail[],
  identity: GitIdentity,
): ProjectCreationPayload {
  const { tracker, gitHost } = state.connect;
  const rolesByProvider = new Map<string, ("tracker" | "gitHost")[]>();
  for (const [role, connection] of [
    ["tracker", tracker],
    ["gitHost", gitHost],
  ] as const) {
    if (!connection.providerId) continue;
    const roles = rolesByProvider.get(connection.providerId) ?? [];
    roles.push(role);
    rolesByProvider.set(connection.providerId, roles);
  }

  const connections = [...rolesByProvider].map(([providerId, roles]) => {
    const source = roles.includes("gitHost") ? gitHost : tracker;
    return {
      providerId,
      roles,
      // In-memory config: the secrets the user entered in this session.
      config: source.config ?? {},
    };
  });

  const repositories: ProjectCreationRepositoryPayload[] =
    state.repositories.selectedRepoIds.map((id) => {
      const config = state.repositories.repoConfigs[id];
      const detail = discovered.find((repository) => repository.id === id);
      return {
        id,
        name: detail?.name ?? id,
        remote: detail?.remote,
        defaultBranch: detail?.defaultBranch,
        localPath: config?.localPath,
        role: repositoryRole(config ?? {}),
        primary: id === state.repositories.primaryRepoId,
      };
    });

  const { name, id, description, workspacePath } = state.basics;
  return {
    id,
    name,
    description: description.trim() ? description : undefined,
    workspacePath: workspacePath.trim() ? workspacePath : undefined,
    gitIdentity: identity,
    connections,
    repositories,
  };
}
