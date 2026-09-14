// src/discovery/azure.ts — Read-only repository discovery for Azure DevOps.

import { loadSettings } from "../settings.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

interface AzureGitRepoItem {
  id: string;
  name: string;
  url?: string;
  remoteUrl?: string;
  webUrl?: string;
  defaultBranch?: string;
}

export class AzureDevOpsRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "azure";

  // fallow-ignore-next-line complexity
  async listRepositories(input: RepositoryDiscoveryInput): Promise<DiscoveredRepository[]> {
    const settings = await loadSettings(false);
    const orgUrl = (input.orgUrl || settings.azure?.orgUrl || "").trim().replace(/\/+$/, "");
    const project = (input.project || settings.azure?.project || "").trim();
    const pat = (input.pat || settings.azure?.pat || "").trim();

    if (!orgUrl) {
      throw new Error("Azure DevOps Organization URL is required for repository discovery.");
    }
    if (!project) {
      throw new Error("Azure DevOps Project name is required for repository discovery.");
    }
    if (!pat) {
      throw new Error("Azure DevOps Personal Access Token (PAT) is required for repository discovery.");
    }

    const apiUrl = `${orgUrl}/${encodeURIComponent(project)}/_apis/git/repositories?api-version=7.1`;
    const auth = Buffer.from(`:${pat}`).toString("base64");

    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error("Azure DevOps authentication failed. Verify your Personal Access Token (PAT).");
    }
    if (res.status === 404) {
      throw new Error(`Azure DevOps project "${project}" was not found at ${orgUrl}.`);
    }
    if (!res.ok) {
      throw new Error(`Azure DevOps API error (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as { value?: AzureGitRepoItem[] };
    const items = data.value || [];

    return items.map((repo) => {
      const cleanBranch = repo.defaultBranch
        ? repo.defaultBranch.replace(/^refs\/heads\//, "")
        : "main";

      return {
        id: repo.id,
        name: repo.name,
        remote: repo.remoteUrl || repo.url || "",
        defaultBranch: cleanBranch,
        webUrl: repo.webUrl,
      };
    });
  }
}
