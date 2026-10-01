// src/frontend/lib/project-identity.ts — Deterministic identity matching for duplicate project detection (XFM-46)

import { normalizeGitRemoteUrl } from "./git-remote.js";
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

function matchesAzureIdentity(
  p: Project,
  targetOrgUrl: string,
  targetProject: string,
): boolean {
  if (!p.issueTracker?.azure) return false;
  const existingOrg = normalizeAzureOrganization(
    p.issueTracker.azure.orgUrl || "",
  );
  const existingProj = normalizeAzureProject(
    p.issueTracker.azure.project || "",
  );
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
  if (!p.issueTracker?.github) return false;
  const existingRepo = normalizeGitHubRepository(
    p.issueTracker.github.repo || "",
  );
  const targetRepo = normalizeGitHubRepository(
    targetProject || targetOrgUrl || "",
  );

  return Boolean(existingRepo && targetRepo && existingRepo === targetRepo);
}

function checkExternalProviderMatch(
  projects: Project[],
  newProvider: string,
  newTrackerOrgUrl: string,
  newTrackerProject: string,
): Project | undefined {
  const normProvider = (newProvider || "").toLowerCase().trim();
  if (!normProvider) return undefined;

  for (const p of projects) {
    const existingProvider = (p.issueTracker?.provider || "")
      .toLowerCase()
      .trim();
    if (existingProvider !== normProvider) continue;

    if (
      normProvider === "azure" &&
      matchesAzureIdentity(p, newTrackerOrgUrl, newTrackerProject)
    ) {
      return p;
    }
    if (
      normProvider === "github" &&
      matchesGitHubIdentity(p, newTrackerProject, newTrackerOrgUrl)
    ) {
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
