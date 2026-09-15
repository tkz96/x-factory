// public/js/wizard-url.ts — Pure URL parsing and role inference functions for onboarding wizard.

import type { RepositoryRole } from "../../src/shared/types.js";

interface ParsedAzureUrl {
  provider: "azure";
  org: string;
  project: string;
  orgUrl: string;
}

interface ParsedGitHubUrl {
  provider: "github";
  owner: string;
  repo: string;
}

export type ParsedQuickUrl = ParsedAzureUrl | ParsedGitHubUrl;

const AZURE_REGEX =
  /^(?:https?:\/\/)?(?:dev\.azure\.com\/([^/]+)\/([^/]+)|([^.]+)\.visualstudio\.com\/([^/]+))/i;

const GITHUB_REGEX = /^(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+)/i;

export function parseQuickUrl(rawUrl: string): ParsedQuickUrl | null {
  const val = (rawUrl || "").trim();
  if (!val) return null;

  const azureMatch = val.match(AZURE_REGEX);
  if (azureMatch) {
    const org = azureMatch[1] || azureMatch[3] || "";
    const rawProject = azureMatch[2] || azureMatch[4] || "";
    const project = decodeURIComponent(rawProject.replace(/\.git$/, ""));
    const orgUrl = `https://dev.azure.com/${org}`;
    return {
      provider: "azure",
      org,
      project,
      orgUrl,
    };
  }

  const ghMatch = val.match(GITHUB_REGEX);
  if (ghMatch) {
    const owner = ghMatch[1] || "";
    const rawRepo = ghMatch[2] || "";
    const repo = decodeURIComponent(rawRepo.replace(/\.git$/, ""));
    return {
      provider: "github",
      owner,
      repo,
    };
  }

  return null;
}

const ROLE_KEYWORDS: Array<[string, RepositoryRole]> = [
  ["knowledge", "knowledge"],
  ["graph", "knowledge"],
  ["front", "frontend"],
  ["web", "frontend"],
  ["ui", "frontend"],
  ["portal", "frontend"],
  ["api", "backend"],
  ["backend", "backend"],
  ["server", "backend"],
  ["worker", "worker"],
  ["pulse", "worker"],
  ["infra", "infrastructure"],
];

export function inferRepoRole(name: string): RepositoryRole {
  const lower = name.toLowerCase();
  for (const [kw, role] of ROLE_KEYWORDS) {
    if (lower.includes(kw)) return role;
  }
  return "other";
}
