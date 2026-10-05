// src/providers/github/repositories.ts — GitHub repository discovery and pagination (#138).

import type { ProviderConfig, ProviderRepository } from "../contract.js";
import { resolveGitHubConfig } from "./config.js";
import { GitHubHttpError } from "./errors.js";
import {
  DEFAULT_GITHUB_API_ROOT,
  githubFetch,
  resolveGitHubHeaders,
} from "./http.js";

interface RawGitHubRepo {
  id?: number | string;
  name?: string;
  full_name?: string;
  clone_url?: string;
  html_url?: string;
  default_branch?: string;
}

function parseNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const parts = linkHeader.split(",");
  for (const part of parts) {
    const section = part.split(";");
    if (section.length >= 2 && section[1]?.includes('rel="next"')) {
      const urlMatch = section[0]?.trim().match(/<([^>]+)>/);
      if (urlMatch?.[1]) {
        return urlMatch[1];
      }
    }
  }
  return null;
}

function mapToProviderRepo(item: RawGitHubRepo): ProviderRepository | null {
  const name =
    item.name || (item.full_name ? item.full_name.split("/")[1] : "");
  if (!name) return null;

  const id = String(item.id || item.full_name || name);
  const remote =
    item.clone_url ||
    item.html_url ||
    `https://github.com/${item.full_name || name}.git`;

  return {
    id,
    name,
    remote,
    ...(item.default_branch ? { defaultBranch: item.default_branch } : {}),
    ...(item.html_url ? { webUrl: item.html_url } : {}),
  };
}

/**
 * Lists repositories for an organization or authenticated user with pagination.
 */
export async function listGitHubRepositories(
  config: ProviderConfig,
  fetchFn?: typeof fetch,
): Promise<ProviderRepository[]> {
  const { token, owner, baseUrl } = resolveGitHubConfig(config);
  const root = baseUrl || DEFAULT_GITHUB_API_ROOT;
  const headers = resolveGitHubHeaders(token);

  let initialUrl: string;
  if (owner) {
    initialUrl = `${root}/orgs/${encodeURIComponent(owner)}/repos?per_page=100&type=all`;
  } else if (token) {
    initialUrl = `${root}/user/repos?per_page=100&affiliation=owner,collaborator,organization_member`;
  } else {
    throw new Error(
      "Cannot list GitHub repositories: no owner or token specified.",
    );
  }

  const allRepos: ProviderRepository[] = [];
  const seenIds = new Set<string>();
  const visitedUrls = new Set<string>();

  let nextUrl: string | null = initialUrl;

  while (nextUrl) {
    // Guard against malformed/repeating pagination links
    if (visitedUrls.has(nextUrl)) break;
    visitedUrls.add(nextUrl);

    let res: { status: number; headers: Headers; data: unknown };

    try {
      res = await githubFetch(nextUrl, { headers, fetchFn });
    } catch (err) {
      // If org probe failed with 404 on page 1, fallback to user endpoint
      if (
        visitedUrls.size === 1 &&
        owner &&
        err instanceof GitHubHttpError &&
        err.status === 404
      ) {
        const userUrl = `${root}/users/${encodeURIComponent(owner)}/repos?per_page=100&type=all`;
        res = await githubFetch(userUrl, { headers, fetchFn });
      } else {
        throw err;
      }
    }

    const items = (Array.isArray(res.data) ? res.data : []) as RawGitHubRepo[];
    for (const raw of items) {
      const mapped = mapToProviderRepo(raw);
      if (mapped && !seenIds.has(mapped.id)) {
        seenIds.add(mapped.id);
        allRepos.push(mapped);
      }
    }

    nextUrl = parseNextPageUrl(res.headers.get("link"));
  }

  return allRepos;
}
