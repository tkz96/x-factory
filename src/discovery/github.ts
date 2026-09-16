// src/discovery/github.ts — Read-only repository discovery for GitHub.

import { type GitHubRepoItem, GitHubRepoListSchema } from "./schemas.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

function resolveGitHubHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "X-Factory-Discovery",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function mapGitHubRepoItem(repo: GitHubRepoItem): DiscoveredRepository {
  return {
    id: String(repo.id),
    name: repo.name,
    remote: repo.clone_url || repo.html_url,
    defaultBranch: repo.default_branch || "main",
    webUrl: repo.html_url,
  };
}

async function fetchGitHubRepos(
  owner: string,
  headers: Record<string, string>,
): Promise<GitHubRepoItem[]> {
  const url = owner
    ? `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?per_page=100&type=all`
    : "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";

  let res = await fetch(url, { headers });

  // If org endpoint returned 404 and owner was specified, try users endpoint
  if (res.status === 404 && owner) {
    const userUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100`;
    res = await fetch(userUrl, { headers });
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(
      "GitHub authentication failed. Check your GitHub Personal Access Token.",
    );
  }
  if (res.status === 404) {
    throw new Error(`GitHub account or organization "${owner}" was not found.`);
  }
  if (!res.ok) {
    throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
  }

  const raw = await res.json();
  const parsed = GitHubRepoListSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `GitHub Repositories API response validation failed: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

export class GitHubRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "github";

  async listRepositories(
    input: RepositoryDiscoveryInput,
  ): Promise<DiscoveredRepository[]> {
    const token = (input.token || process.env.GITHUB_TOKEN || "").trim();
    const owner = (input.repoOwner || process.env.GITHUB_OWNER || "").trim();
    const headers = resolveGitHubHeaders(token);

    const items = await fetchGitHubRepos(owner, headers);
    return items.map(mapGitHubRepoItem);
  }
}
