// src/discovery/jira.ts — Read-only repository & component discovery for Jira.

import { loadSettings } from "../settings.js";
import { LocalWorkspaceRepositoryDiscovery } from "./local.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

interface JiraComponentItem {
  id: string;
  name: string;
  description?: string;
}

export class JiraRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "jira";

  // fallow-ignore-next-line complexity
  async listRepositories(input: RepositoryDiscoveryInput): Promise<DiscoveredRepository[]> {
    const settings = await loadSettings(false);
    const host = (input.jiraHost || settings.jira?.host || "").trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
    const email = (input.jiraEmail || settings.jira?.email || "").trim();
    const token = (input.jiraToken || settings.jira?.token || "").trim();
    const project = (input.project || settings.jira?.project || "").trim();
    const workspacePath = (input.workspacePath || "").trim();

    // If local workspace path is specified and accessible, try local discovery as well
    const localProvider = new LocalWorkspaceRepositoryDiscovery();

    // If Jira credentials and project key are configured, attempt component discovery
    if (host && email && token && project) {
      try {
        const auth = Buffer.from(`${email}:${token}`).toString("base64");
        const apiUrl = `https://${host}/rest/api/3/project/${encodeURIComponent(project)}/components`;

        const res = await fetch(apiUrl, {
          headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
          },
        });

        if (res.ok) {
          const components = (await res.json()) as JiraComponentItem[];
          if (Array.isArray(components) && components.length > 0) {
            return components.map((c) => ({
              id: c.id,
              name: c.name,
              remote: "",
              defaultBranch: "main",
              webUrl: `https://${host}/jira/software/projects/${encodeURIComponent(project)}/components/${c.id}`,
            }));
          }
        }
      } catch {
        // Fall back to workspace directory discovery if available
      }
    }

    // Fallback: If workspace path is provided, discover local repositories
    if (workspacePath) {
      return localProvider.listRepositories(input);
    }

    // If neither Jira credentials nor workspace path were available
    if (!host || !token) {
      throw new Error(
        "Jira repository discovery requires Jira credentials in Settings or a Local Workspace Root directory."
      );
    }

    if (!project) {
      throw new Error("Jira project key is required for component discovery.");
    }

    return [];
  }
}
