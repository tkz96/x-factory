// src/trackers/index.ts — Pluggable issue tracker registry and unified resolver.

import { getProject } from "../config.js";
import { loadSettings } from "../settings.js";
import { tryFetchAzure } from "./azure.js";
import { detectGitHubRepo, fetchGitHubTickets } from "./github.js";
import { tryFetchJira } from "./jira.js";
import type { TrackerOptions, TrackerTicket } from "./types.js";

export { fetchAzureTickets } from "./azure.js";
export { fetchGitHubTickets } from "./github.js";
export { fetchJiraTickets } from "./jira.js";
export * from "./parser.js";
export * from "./types.js";

async function fetchDefaultGitHub(
  repoPath: string,
  options: TrackerOptions,
  settings: Awaited<ReturnType<typeof loadSettings>>,
): Promise<TrackerTicket[]> {
  const token = options.githubToken || settings.github?.token;
  const repo =
    options.githubRepo ||
    settings.github?.repo ||
    (await detectGitHubRepo(repoPath)) ||
    undefined;

  return fetchGitHubTickets({
    repo,
    token,
    cwd: repoPath,
    requiredLabel: options.requiredLabel,
  });
}

/**
 * Unified resolver for project tickets across GitHub, Jira, and Azure DevOps.
 */
export async function fetchProjectTickets(
  projectId: string,
  options: TrackerOptions = {},
): Promise<TrackerTicket[]> {
  const project = await getProject(projectId);
  if (!project) {
    throw new Error(`Project "${projectId}" not found.`);
  }

  const settings = await loadSettings(false);
  const provider =
    options.provider ||
    project.issueTracker?.connectionId ||
    settings.activeTracker ||
    "github";

  const resolvedOptions: TrackerOptions = {
    ...options,
    azureProject: options.azureProject || project.issueTracker?.projectId,
    jiraProject: options.jiraProject || project.issueTracker?.projectId,
  };

  const jira = tryFetchJira(provider, resolvedOptions, settings.jira);
  if (jira) return jira;

  const azure = tryFetchAzure(provider, resolvedOptions, settings.azure);
  if (azure) return azure;

  return fetchDefaultGitHub(project.repositoryPath, resolvedOptions, settings);
}
