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

export function extractAzureDevOpsInfo(value?: string): { orgUrl?: string; project?: string } {
  if (!value) return {};
  const trimmed = value.trim();
  const devAzureMatch = trimmed.match(/^https?:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)(?:\/_git\/([^/]+))?/i);
  if (devAzureMatch) {
    return {
      orgUrl: `https://dev.azure.com/${devAzureMatch[1]}`,
      project: decodeURIComponent(devAzureMatch[2]),
    };
  }
  const vsMatch = trimmed.match(/^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)(?:\/_git\/([^/]+))?/i);
  if (vsMatch) {
    return {
      orgUrl: `https://${vsMatch[1]}.visualstudio.com`,
      project: decodeURIComponent(vsMatch[2]),
    };
  }
  return {};
}

export class AzureDevOpsRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "azure";

  // fallow-ignore-next-line complexity
  async listRepositories(input: RepositoryDiscoveryInput): Promise<DiscoveredRepository[]> {
    const settings = await loadSettings(false);
    const parsed = extractAzureDevOpsInfo(input.primaryRepo || input.project || input.orgUrl);
    const orgUrl = (input.orgUrl || parsed.orgUrl || settings.azure?.orgUrl || "").trim().replace(/\/+$/, "");
    const project = (parsed.project || input.project || settings.azure?.project || "").trim();
    const pat = (input.pat || settings.azure?.pat || "").trim();

    if (!orgUrl) {
      throw new Error(
        "Azure DevOps Organization URL is required (e.g. https://dev.azure.com/xynotech). Configure it in Settings or enter it in the discovery form."
      );
    }
    if (!project) {
      throw new Error(
        "Azure DevOps Project name is required (e.g. Converso). Enter it in the Tracker Project field or provide the full repository URL."
      );
    }
    if (!pat) {
      throw new Error(
        "Azure DevOps Personal Access Token (PAT) with Code (Read) permission is required to query Azure Repos online. Configure it in Settings (Settings → Trackers) or enter it in the discovery form. Alternatively, choose \"Local Workspace Folder\" to discover local clones without a PAT."
      );
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
