// src/frontend/lib/wizard-repositories.ts — Repository configuration helpers and types for onboarding wizard (Issue #112).

import type { ProjectRepository, RepositoryRole } from "../../shared/types.js";
import { inferRepoRole } from "./wizard-url.js";

export const REPOSITORY_ROLES: readonly RepositoryRole[] = [
  "frontend",
  "backend",
  "service",
  "worker",
  "mobile",
  "infrastructure",
  "documentation",
  "knowledge",
  "other",
];

export interface RepoItemConfig {
  selected: boolean;
  path: string;
  role: RepositoryRole;
}

export interface DiscoveredRepositoryLike {
  id: string;
  name: string;
  remote?: string | undefined;
  defaultBranch?: string | undefined;
  webUrl?: string | undefined;
}

/**
 * Deduplicate discovered repositories by exact ID using first-entry-wins.
 */
export function deduplicateDiscoveredRepositories<T extends { id: string }>(
  repos: readonly T[],
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const repo of repos) {
    if (!repo.id || seen.has(repo.id)) continue;
    seen.add(repo.id);
    result.push(repo);
  }
  return result;
}

/**
 * Initialize repository configs for discovered repositories.
 * Deduplicates by exact ID (first-entry-wins) to ensure path and role match the displayed entry.
 */
export function getInitialRepoConfigs(
  repos: readonly DiscoveredRepositoryLike[],
  workspacePath: string,
): Record<string, RepoItemConfig> {
  const unique = deduplicateDiscoveredRepositories(repos);
  const cleanWs = workspacePath.trim().replace(/\/+$/, "");
  const configs: Record<string, RepoItemConfig> = {};
  for (const repo of unique) {
    configs[repo.id] = {
      selected: true,
      path: cleanWs ? `${cleanWs}/${repo.name}` : `/${repo.name}`,
      role: inferRepoRole(repo.name),
    };
  }
  return configs;
}

/**
 * Determine the initial primary repository ID based on matching project ID or first entry.
 */
export function getInitialPrimaryRepoId(
  repos: readonly DiscoveredRepositoryLike[],
  projectId: string,
): string | null {
  const unique = deduplicateDiscoveredRepositories(repos);
  if (unique.length === 0) return null;
  const trimmed = projectId.trim().toLowerCase();
  const matching = unique.find(
    (r) => r.name.toLowerCase() === trimmed || r.id.toLowerCase() === trimmed,
  );
  return matching ? matching.id : (unique[0]?.id ?? null);
}

/**
 * Get effective repository configuration falling back to default calculated values if not yet in state.
 */
export function getEffectiveRepoConfig(
  repo: DiscoveredRepositoryLike,
  configs: Record<string, RepoItemConfig>,
  workspacePath: string,
): RepoItemConfig {
  const existing = configs[repo.id];
  if (existing) {
    return existing;
  }
  const cleanWs = workspacePath.trim().replace(/\/+$/, "");
  return {
    selected: true,
    path: cleanWs ? `${cleanWs}/${repo.name}` : `/${repo.name}`,
    role: inferRepoRole(repo.name),
  };
}

/**
 * Validate repository selection and primary designation.
 * Returns an error message if invalid, or null if valid.
 */
export function validateRepositorySelection(params: {
  selectedRepos: readonly DiscoveredRepositoryLike[];
  primaryRepoId: string | null;
}): string | null {
  const { selectedRepos, primaryRepoId } = params;
  if (selectedRepos.length === 0) {
    return "At least one repository must be selected.";
  }
  if (!primaryRepoId) {
    return "A primary repository must be designated.";
  }
  const primarySelected = selectedRepos.some((r) => r.id === primaryRepoId);
  if (!primarySelected) {
    return "The primary repository must be selected.";
  }
  return null;
}

/**
 * Synchronously derive the configured repository array in primary-first order.
 * Strictly preserves discovered id, name, remote, and defaultBranch.
 */
export function deriveConfiguredRepositories(params: {
  discoveredRepositories: readonly DiscoveredRepositoryLike[];
  repoConfigs: Record<string, RepoItemConfig>;
  primaryRepoId: string | null;
  workspacePath: string;
  projectId: string;
}): ProjectRepository[] {
  const {
    discoveredRepositories,
    repoConfigs,
    primaryRepoId,
    workspacePath,
    projectId,
  } = params;

  const uniqueDiscovered = deduplicateDiscoveredRepositories(
    discoveredRepositories,
  );
  if (uniqueDiscovered.length === 0) return [];

  const effectivePrimaryId =
    primaryRepoId && uniqueDiscovered.some((r) => r.id === primaryRepoId)
      ? primaryRepoId
      : getInitialPrimaryRepoId(uniqueDiscovered, projectId);

  const selectedRepos = uniqueDiscovered.filter((r) => {
    const cfg = getEffectiveRepoConfig(r, repoConfigs, workspacePath);
    return cfg.selected;
  });

  const validationError = validateRepositorySelection({
    selectedRepos,
    primaryRepoId: effectivePrimaryId,
  });

  if (validationError || !effectivePrimaryId) {
    return [];
  }

  const primaryRepo = uniqueDiscovered.find((r) => r.id === effectivePrimaryId);
  if (!primaryRepo) return [];
  const primaryConfig = getEffectiveRepoConfig(
    primaryRepo,
    repoConfigs,
    workspacePath,
  );
  if (!primaryConfig.selected) return [];

  const primaryItem: ProjectRepository = {
    id: primaryRepo.id,
    name: primaryRepo.name,
    remote: primaryRepo.remote,
    defaultBranch: primaryRepo.defaultBranch ?? "main",
    path: primaryConfig.path,
    role: primaryConfig.role,
  };

  const otherItems: ProjectRepository[] = selectedRepos
    .filter((r) => r.id !== primaryRepo.id)
    .map((r) => {
      const cfg = getEffectiveRepoConfig(r, repoConfigs, workspacePath);
      return {
        id: r.id,
        name: r.name,
        remote: r.remote,
        defaultBranch: r.defaultBranch ?? "main",
        path: cfg.path,
        role: cfg.role,
      };
    });

  const seenIds = new Set<string>();
  const result: ProjectRepository[] = [];
  if (!seenIds.has(primaryItem.id)) {
    seenIds.add(primaryItem.id);
    result.push(primaryItem);
  }
  for (const item of otherItems) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      result.push(item);
    }
  }
  return result;
}
