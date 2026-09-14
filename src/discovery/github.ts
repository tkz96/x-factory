// src/discovery/github.ts — Read-only repository discovery for GitHub.

import { loadSettings } from "../settings.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

interface GitHubRepoItem {
  id: number;
  name: string;
  full_name: string;
  clone_url: string;
  html_url: string;
  default_branch?: string;
}

export class GitHubRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "github";

  // fallow-ignore-next-line complexity
  async listRepositories(input: RepositoryDiscoveryInput): Promise<DiscoveredRepository[]> {
    const settings = await loadSettings(false);
    const token = (input.token || settings.github?.token || "").trim();
    const owner = (input.repoOwner || settings.github?.repo?.split("/")[0] || "").trim();

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "X-Factory-Discovery",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let url: string;
    if (owner) {
      url = `https://api.github.com/orgs/${encodeURIComponent(owner)}/repos?per_page=100&type=all`;
    } else {
      url = "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";
    }

    let res = await fetch(url, { headers });

    // If org endpoint returned 404 and owner was specified, try users endpoint
    if (res.status === 404 && owner) {
      const userUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=100`;
      res = await fetch(userUrl, { headers });
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error("GitHub authentication failed. Check your GitHub Personal Access Token.");
    }
    if (res.status === 404) {
      throw new Error(`GitHub account or organization "${owner}" was not found.`);
    }
    if (!res.ok) {
      throw new Error(`GitHub API error (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as GitHubRepoItem[];
    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((repo) => ({
      id: String(repo.id),
      name: repo.name,
      remote: repo.clone_url || repo.html_url,
      defaultBranch: repo.default_branch || "main",
      webUrl: repo.html_url,
    }));
  }
}
