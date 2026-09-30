// src/frontend/lib/project-identity.ts — Deterministic identity matching for duplicate project detection (XFM-46)

import type { Project } from "../../shared/types.js";

export function normalizeProjectId(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "");
}

export function normalizeAzureOrganization(url: string): string {
  try {
    let lower = url.toLowerCase().trim();
    if (!lower.startsWith("http")) {
      lower = `https://${lower}`;
    }
    const parsed = new URL(lower);
    // Remove trailing slashes and common dev.azure.com path normalization
    return parsed.origin + parsed.pathname.replace(/\/+$/, "");
  } catch {
    return url.toLowerCase().trim().replace(/\/+$/, "");
  }
}

export function normalizeAzureProject(name: string): string {
  return name.toLowerCase().trim();
}

export function normalizeGitHubRepository(repo: string): string {
  return repo.toLowerCase().trim();
}

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

  return { isDuplicate: false };
}
