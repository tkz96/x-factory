// src/frontend/lib/project-identity.ts — Deterministic identity matching for duplicate project detection (XFM-46)

import { normalizeGitRemoteUrl } from "./git-remote.js";
import {
  legacyTrackerConfig,
  legacyTrackerProviderId,
} from "./legacy-tracker.js";
import {
  normalizeAzureOrganization,
  normalizeAzureProject,
  normalizeGitHubRepository,
  normalizeProjectId,
} from "./normalization.js";

export {
  normalizeAzureOrganization,
  normalizeAzureProject,
  normalizeGitHubRepository,
  normalizeProjectId,
};

import type { Project } from "./types.js";

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  type?: "id_collision" | "external_identity";
  existingProject?: Project;
}

function checkLocalIdCollision(
  projects: Project[],
  newId: string,
): Project | undefined {
  const normId = normalizeProjectId(newId);
  if (!normId) return undefined;
  return projects.find((p) => p.id && normalizeProjectId(p.id) === normId);
}

/**
 * The legacy tracker a record names, read by the one shared legacy reader. This
 * module is registry-free (the frontend imports it), so any namespaced view is
 * accepted as a provider identity here.
 */
function legacyProviderOf(p: Project): string | null {
  return legacyTrackerProviderId(p.issueTracker, () => true);
}

/** The provider ids a project's connections (or its legacy tracker) name. */
function providerIdsOf(p: Project): string[] {
  const ids = (p.connections ?? []).map((c) => c.providerId);
  const legacy = legacyProviderOf(p);
  if (legacy) ids.push(legacy);
  return ids.map((id) => id.toLowerCase().trim());
}

/**
 * The configuration a project holds for one provider: its connection's config
 * when it has one (wizard-created projects), otherwise the legacy view.
 */
function providerConfigOf(
  p: Project,
  providerId: string,
): Record<string, unknown> | undefined {
  const connection = p.connections?.find(
    (c) => c.providerId.toLowerCase().trim() === providerId,
  );
  if (connection) return connection.config;
  if (legacyProviderOf(p) !== providerId) return undefined;
  return legacyTrackerConfig(p.issueTracker, providerId);
}

function textField(config: Record<string, unknown> | undefined, key: string) {
  const value = config?.[key];
  return typeof value === "string" ? value : "";
}

function matchesAzureIdentity(
  p: Project,
  targetOrgUrl: string,
  targetProject: string,
): boolean {
  const config = providerConfigOf(p, "azure");
  if (!config) return false;
  const existingOrg = normalizeAzureOrganization(textField(config, "orgUrl"));
  const existingProj = normalizeAzureProject(textField(config, "project"));
  const targetOrg = normalizeAzureOrganization(targetOrgUrl || "");
  const targetProj = normalizeAzureProject(targetProject || "");

  return Boolean(
    existingOrg &&
      existingProj &&
      targetOrg &&
      targetProj &&
      existingOrg === targetOrg &&
      existingProj === targetProj,
  );
}

function matchesGitHubIdentity(
  p: Project,
  targetProject: string,
  targetOrgUrl: string,
): boolean {
  const config = providerConfigOf(p, "github");
  if (!config) return false;
  // A legacy view names the repository as `repo`; a wizard-created connection
  // names it as an owner and a repository.
  const owner = textField(config, "repoOwner").trim();
  const repository = textField(config, "repository").trim();
  const existingRepo = normalizeGitHubRepository(
    textField(config, "repo") ||
      (owner && repository ? `${owner}/${repository}` : repository),
  );
  const targetRepo = normalizeGitHubRepository(
    targetProject || targetOrgUrl || "",
  );

  return Boolean(existingRepo && targetRepo && existingRepo === targetRepo);
}

const IDENTITY_MATCHERS: Record<
  string,
  (p: Project, newTrackerOrgUrl: string, newTrackerProject: string) => boolean
> = {
  azure: matchesAzureIdentity,
  github: (p, orgUrl, project) => matchesGitHubIdentity(p, project, orgUrl),
};

function checkExternalProviderMatch(
  projects: Project[],
  newProvider: string,
  newTrackerOrgUrl: string,
  newTrackerProject: string,
): Project | undefined {
  const normProvider = (newProvider || "").toLowerCase().trim();
  if (!normProvider) return undefined;

  const matcher = IDENTITY_MATCHERS[normProvider];
  if (!matcher) return undefined;

  for (const p of projects) {
    if (!providerIdsOf(p).includes(normProvider)) continue;

    if (matcher(p, newTrackerOrgUrl, newTrackerProject)) {
      return p;
    }
  }
  return undefined;
}

function checkDiscoveredRemoteMatch(
  projects: Project[],
  discoveredRepositories: Array<{ remote?: string | undefined }>,
): Project | undefined {
  if (!discoveredRepositories || !Array.isArray(discoveredRepositories)) {
    return undefined;
  }

  for (const repo of discoveredRepositories) {
    if (!repo?.remote) continue;
    const normalizedNewRemote = normalizeGitRemoteUrl(repo.remote);
    if (!normalizedNewRemote) continue;

    for (const p of projects) {
      if (!p.repositories || !Array.isArray(p.repositories)) continue;
      for (const pRepo of p.repositories) {
        if (!pRepo?.remote) continue;
        if (normalizeGitRemoteUrl(pRepo.remote) === normalizedNewRemote) {
          return p;
        }
      }
    }
  }
  return undefined;
}

export function findDuplicateProject(
  projects: Project[],
  newId: string,
  newProvider: string,
  newTrackerOrgUrl: string,
  newTrackerProject: string,
  discoveredRepositories: Array<{ remote?: string | undefined }> = [],
): DuplicateDetectionResult {
  // 1. Exact local Project ID collision
  const idCollision = checkLocalIdCollision(projects, newId);
  if (idCollision) {
    return {
      isDuplicate: true,
      type: "id_collision",
      existingProject: idCollision,
    };
  }

  // 2. Same external project identity
  const externalMatch = checkExternalProviderMatch(
    projects,
    newProvider,
    newTrackerOrgUrl,
    newTrackerProject,
  );
  if (externalMatch) {
    return {
      isDuplicate: true,
      type: "external_identity",
      existingProject: externalMatch,
    };
  }

  // 3. Match discovered repository remotes
  const remoteMatch = checkDiscoveredRemoteMatch(
    projects,
    discoveredRepositories,
  );
  if (remoteMatch) {
    return {
      isDuplicate: true,
      type: "external_identity",
      existingProject: remoteMatch,
    };
  }

  return { isDuplicate: false };
}
