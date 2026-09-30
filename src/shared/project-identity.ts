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

export function findDuplicateProject(
  projects: Project[],
  newId: string,
  newProvider: string,
  newTrackerOrgUrl: string,
  newTrackerProject: string,
  discoveredRepositories: Array<{ remote?: string | undefined }> = [],
): DuplicateDetectionResult {
  const normId = normalizeProjectId(newId);

  // 1. Exact local Project ID collision
  const idCollision = projects.find((p) => normalizeProjectId(p.id) === normId);

  if (idCollision) {
    return {
      isDuplicate: true,
      type: "id_collision",
      existingProject: idCollision,
    };
  }

  // 2. Same external project identity
  for (const p of projects) {
    if (p.issueTracker.provider !== newProvider) {
      continue;
    }

    if (newProvider === "azure" && p.issueTracker.azure) {
      if (
        normalizeAzureOrganization(p.issueTracker.azure.orgUrl) ===
          normalizeAzureOrganization(newTrackerOrgUrl) &&
        normalizeAzureProject(p.issueTracker.azure.project) ===
          normalizeAzureProject(newTrackerProject)
      ) {
        return {
          isDuplicate: true,
          type: "external_identity",
          existingProject: p,
        };
      }
    }

    if (newProvider === "github" && p.issueTracker.github) {
      if (
        normalizeGitHubRepository(p.issueTracker.github.repo) ===
        normalizeGitHubRepository(newTrackerProject)
      ) {
        return {
          isDuplicate: true,
          type: "external_identity",
          existingProject: p,
        };
      }
    }
  }

  // 3. Match discovered repository remotes
  for (const repo of discoveredRepositories) {
    if (!repo.remote) continue;
    const normalizedNewRemote = normalizeGitRemoteUrl(repo.remote);

    for (const p of projects) {
      for (const pRepo of p.repositories) {
        if (!pRepo.remote) continue;
        if (normalizeGitRemoteUrl(pRepo.remote) === normalizedNewRemote) {
          return {
            isDuplicate: true,
            type: "external_identity",
            existingProject: p,
          };
        }
      }
    }
  }

  return { isDuplicate: false };
}
