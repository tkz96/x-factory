// src/providers/github/urls.ts — GitHub URL parsing, quick-URL intake, and coordinate resolution (#138).

import type { QuickUrlDraft } from "../contract.js";

/**
 * Extracts owner and repository name from a GitHub URL (HTTPS or SSH).
 * Returns null if the URL is not a GitHub URL.
 */
export function extractFromGitHubUrl(
  url: string,
): { owner?: string; repo?: string } | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  // 1. SSH format: git@github.com:owner/repo.git or ssh://git@github.com/owner/repo.git
  if (
    trimmed.startsWith("git@github.com:") ||
    trimmed.includes("@github.com:")
  ) {
    const afterColon = trimmed.split("@github.com:")[1];
    if (afterColon) {
      const parts = afterColon.split("/").filter(Boolean);
      if (parts.length >= 2) {
        const owner = parts[0];
        const repo = parts[1]?.replace(/\.git$/i, "");
        if (owner && repo) {
          return { owner, repo };
        }
      }
    }
  }

  // 2. HTTP/HTTPS or hostname format
  try {
    let toParse = trimmed;
    if (!toParse.startsWith("http://") && !toParse.startsWith("https://")) {
      toParse = `https://${toParse}`;
    }
    const parsed = new URL(toParse);
    if (
      parsed.hostname !== "github.com" &&
      parsed.hostname !== "www.github.com"
    ) {
      return null;
    }

    const segments = parsed.pathname.split("/").filter(Boolean);
    if (segments.length >= 2) {
      const owner = segments[0];
      const repo = segments[1]?.replace(/\.git$/i, "");
      if (owner && repo) {
        return { owner, repo };
      }
    } else if (segments.length === 1 && segments[0]) {
      return { owner: segments[0] };
    }
  } catch {
    // Malformed URL
  }

  return null;
}

/**
 * Parses repository input string into `{ owner, repo }` coordinates.
 */
export function resolveRepoCoordinates(
  repository: string,
  defaultOwner?: string,
): { owner: string; repo: string } {
  const trimmed = repository.trim();
  if (trimmed.includes("/")) {
    if (
      trimmed.startsWith("http://") ||
      trimmed.startsWith("https://") ||
      trimmed.includes("github.com")
    ) {
      const parsed = extractFromGitHubUrl(trimmed);
      if (parsed?.owner && parsed.repo) {
        return { owner: parsed.owner, repo: parsed.repo };
      }
    }
    const parts = trimmed.split("/").filter(Boolean);
    if (parts.length >= 2) {
      const owner = parts[parts.length - 2];
      const repo = parts[parts.length - 1]?.replace(/\.git$/i, "");
      if (owner && repo) {
        return { owner, repo };
      }
    }
  }

  if (!defaultOwner) {
    throw new Error(
      `Cannot resolve GitHub repository "${repository}": no owner or organization specified.`,
    );
  }

  return {
    owner: defaultOwner,
    repo: trimmed.replace(/\.git$/i, ""),
  };
}

/**
 * Parses a GitHub quick-URL intake string into a draft configuration and inferred name.
 */
export function parseGitHubQuickUrl(url: string): QuickUrlDraft | null {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();

  // Quick exclusion for other known providers
  if (
    trimmed.includes("atlassian.net") ||
    trimmed.includes("dev.azure.com") ||
    trimmed.includes("visualstudio.com") ||
    trimmed.includes("gitlab.com")
  ) {
    return null;
  }

  const extracted = extractFromGitHubUrl(trimmed);
  if (!extracted?.owner) {
    return null;
  }

  const { owner, repo } = extracted;
  return {
    configDraft: {
      repoOwner: owner,
      ...(repo ? { repository: repo } : {}),
    },
    inferredName: repo || owner,
  };
}
