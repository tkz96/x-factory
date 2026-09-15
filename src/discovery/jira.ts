// src/discovery/jira.ts — Read-only repository & component discovery for Jira.

import { loadSettings } from "../settings.js";
import { LocalWorkspaceRepositoryDiscovery } from "./local.js";
import { JiraComponentListSchema } from "./schemas.js";
import type {
  DiscoveredRepository,
  RepositoryDiscoveryInput,
  RepositoryDiscoveryProvider,
} from "./types.js";

async function tryFetchJiraComponents(
  host: string,
  email: string,
  token: string,
  project: string,
): Promise<DiscoveredRepository[] | null> {
  try {
    const auth = Buffer.from(`${email}:${token}`).toString("base64");
    const apiUrl = `https://${host}/rest/api/3/project/${encodeURIComponent(project)}/components`;

    const res = await fetch(apiUrl, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) return null;
    const raw = await res.json();
    const parsed = JiraComponentListSchema.safeParse(raw);
    if (!parsed.success || parsed.data.length === 0) return null;

    return parsed.data.map((c) => ({
      id: c.id,
      name: c.name,
      remote: "",
      defaultBranch: "main",
      webUrl: `https://${host}/jira/software/projects/${encodeURIComponent(project)}/components/${c.id}`,
    }));
  } catch {
    return null;
  }
}

function pickString(...vals: (string | undefined)[]): string {
  for (const v of vals) {
    if (v?.trim()) return v.trim();
  }
  return "";
}

function resolveJiraParams(
  input: RepositoryDiscoveryInput,
  settings: {
    jira?:
      | {
          host?: string | undefined;
          email?: string | undefined;
          token?: string | undefined;
          project?: string | undefined;
        }
      | undefined;
  },
) {
  const host = pickString(input.jiraHost, settings.jira?.host)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  const email = pickString(input.jiraEmail, settings.jira?.email);
  const token = pickString(input.jiraToken, settings.jira?.token);
  const project = pickString(input.project, settings.jira?.project);
  const workspacePath = (input.workspacePath || "").trim();

  return { host, email, token, project, workspacePath };
}

function hasJiraCredentials(
  host: string,
  email: string,
  token: string,
  project: string,
): boolean {
  return Boolean(host && email && token && project);
}

function validateRequiredJira(
  host: string,
  token: string,
  project: string,
): void {
  if (!host || !token) {
    throw new Error(
      "Jira repository discovery requires Jira credentials in Settings or a Local Workspace Root directory.",
    );
  }
  if (!project) {
    throw new Error("Jira project key is required for component discovery.");
  }
}

export class JiraRepositoryDiscovery implements RepositoryDiscoveryProvider {
  public readonly provider = "jira";

  async listRepositories(
    input: RepositoryDiscoveryInput,
  ): Promise<DiscoveredRepository[]> {
    const settings = await loadSettings(false);
    const { host, email, token, project, workspacePath } = resolveJiraParams(
      input,
      settings,
    );

    if (hasJiraCredentials(host, email, token, project)) {
      const components = await tryFetchJiraComponents(
        host,
        email,
        token,
        project,
      );
      if (components && components.length > 0) return components;
    }

    if (workspacePath) {
      return new LocalWorkspaceRepositoryDiscovery().listRepositories(input);
    }

    validateRequiredJira(host, token, project);
    return [];
  }
}
