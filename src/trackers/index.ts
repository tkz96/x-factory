// src/trackers/index.ts — Pluggable issue tracker registry and unified resolver.

import { getProject } from "../config.js";
import { loadProjectEnv, PROJECT_ENV_KEYS } from "../project-env.js";
import { fetchAzureTickets } from "./azure.js";
import { detectGitHubRepo, fetchGitHubTickets } from "./github.js";
import { fetchJiraTickets } from "./jira.js";
import type { TrackerOptions, TrackerTicket } from "./types.js";

export { fetchAzureTickets } from "./azure.js";
export { fetchGitHubTickets } from "./github.js";
export { fetchJiraTickets } from "./jira.js";
export * from "./parser.js";
export * from "./types.js";

/**
 * Unified resolver for project tickets across GitHub, Jira, and Azure DevOps.
 * Resolves configuration and credentials strictly from project settings and project .env secrets.
 */
export async function fetchProjectTickets(
  projectId: string,
  options: TrackerOptions = {},
): Promise<TrackerTicket[]> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" not found.`);
  }

  if (project.archived) {
    throw new Error(
      `Project "${projectId}" is archived. Ticket fetching is disabled.`,
    );
  }

  const tracker = project.issueTracker;
  const provider = (options.provider ||
    tracker?.provider ||
    tracker?.connectionId) as "azure" | "jira" | "github" | undefined;

  if (!provider) {
    throw new Error(`Project "${projectId}" has no issue tracker configured.`);
  }

  const env = await loadProjectEnv(projectId);

  if (provider === "azure") {
    const azureCfg = tracker?.azure;
    const orgUrl = options.azureOrgUrl || azureCfg?.orgUrl;
    const azureProj =
      options.azureProject || azureCfg?.project || tracker?.projectId;
    const pat =
      options.azurePat ||
      env[PROJECT_ENV_KEYS.AZURE_PAT] ||
      process.env.AZURE_DEVOPS_PAT ||
      undefined;
    const requiredLabel = options.requiredLabel || azureCfg?.requiredLabel;

    if (!orgUrl || !azureProj) {
      throw new Error(
        `Azure DevOps issue tracker configuration is incomplete for project "${projectId}". Requires orgUrl and project.`,
      );
    }

    return fetchAzureTickets({
      orgUrl,
      project: azureProj,
      pat,
      requiredLabel,
    });
  }

  if (provider === "jira") {
    const jiraCfg = tracker?.jira;
    const host = options.jiraHost || jiraCfg?.host;
    const email = options.jiraEmail || jiraCfg?.email;
    const token =
      options.jiraToken ||
      env[PROJECT_ENV_KEYS.JIRA_TOKEN] ||
      process.env.JIRA_API_TOKEN;
    const jiraProj =
      options.jiraProject || jiraCfg?.project || tracker?.projectId;
    const requiredLabel = options.requiredLabel || jiraCfg?.requiredLabel;

    if (!host || !email || !token) {
      throw new Error(
        `Jira issue tracker configuration is incomplete for project "${projectId}". Requires host, email, and API token.`,
      );
    }

    return fetchJiraTickets({
      host,
      email,
      token,
      project: jiraProj,
      requiredLabel,
    });
  }

  if (provider === "github") {
    const ghCfg = tracker?.github;
    const repo =
      options.githubRepo ||
      ghCfg?.repo ||
      (await detectGitHubRepo(project.repositoryPath)) ||
      undefined;
    const token =
      options.githubToken ||
      env[PROJECT_ENV_KEYS.GITHUB_TOKEN] ||
      process.env.GITHUB_TOKEN ||
      undefined;
    const requiredLabel = options.requiredLabel || ghCfg?.requiredLabel;

    return fetchGitHubTickets({
      repo,
      token,
      cwd: project.repositoryPath,
      requiredLabel,
    });
  }

  throw new Error(`Unsupported issue tracker provider: "${provider}".`);
}
