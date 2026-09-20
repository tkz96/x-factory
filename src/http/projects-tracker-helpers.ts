// src/http/projects-tracker-helpers.ts — Tracker credential resolution, provider testing, and migration helpers.

import { testAzureConnection } from "../azure/connection.js";
import { PROJECT_ENV_KEYS } from "../project-env.js";
import { maskSecret } from "../settings.js";
import { fetchGitHubTickets, fetchJiraTickets } from "../trackers/index.js";
import type {
  IssueTrackerProvider,
  Project,
  ProjectIssueTracker,
} from "../types.js";

export interface ProjectTrackerSummary {
  provider: IssueTrackerProvider;
  config: Record<string, unknown>;
  hasSecret: boolean;
  secretMask: string;
  secretKey: string;
}

/**
 * Resolves secret status, masked value, and provider configuration for a project's issue tracker.
 */
export function resolveProjectTrackerSummary(
  tracker: ProjectIssueTracker | undefined,
  env: Record<string, string>,
): ProjectTrackerSummary {
  const provider = (tracker?.provider ||
    tracker?.connectionId ||
    "github") as IssueTrackerProvider;

  let hasSecret = false;
  let secretMask = "";
  let secretKey = "";

  if (provider === "azure") {
    secretKey = PROJECT_ENV_KEYS.AZURE_PAT;
    const pat = env[secretKey] || process.env.AZURE_DEVOPS_PAT;
    hasSecret = Boolean(pat?.trim());
    secretMask = hasSecret ? maskSecret(pat) : "";
  } else if (provider === "jira") {
    secretKey = PROJECT_ENV_KEYS.JIRA_TOKEN;
    const token = env[secretKey] || process.env.JIRA_API_TOKEN;
    hasSecret = Boolean(token?.trim());
    secretMask = hasSecret ? maskSecret(token) : "";
  } else if (provider === "github") {
    secretKey = PROJECT_ENV_KEYS.GITHUB_TOKEN;
    const token = env[secretKey] || process.env.GITHUB_TOKEN;
    hasSecret = Boolean(token?.trim());
    secretMask = hasSecret ? maskSecret(token) : "";
  }

  const trackerConfig = (tracker?.[provider] || {}) as Record<string, unknown>;

  return {
    provider,
    config: trackerConfig,
    hasSecret,
    secretMask,
    secretKey,
  };
}

/**
 * Extracts and maps credential values (including convenient aliases) into PROJECT_ENV_KEYS.
 */
export function extractTrackerCredentialsToSave(
  body: Record<string, string>,
  provider: string,
): Record<string, string> {
  const varsToSave: Record<string, string> = {};

  const azurePat = body[PROJECT_ENV_KEYS.AZURE_PAT];
  if (typeof azurePat === "string") {
    varsToSave[PROJECT_ENV_KEYS.AZURE_PAT] = azurePat;
  }
  const ghToken = body[PROJECT_ENV_KEYS.GITHUB_TOKEN];
  if (typeof ghToken === "string") {
    varsToSave[PROJECT_ENV_KEYS.GITHUB_TOKEN] = ghToken;
  }
  const jiraToken = body[PROJECT_ENV_KEYS.JIRA_TOKEN];
  if (typeof jiraToken === "string") {
    varsToSave[PROJECT_ENV_KEYS.JIRA_TOKEN] = jiraToken;
  }

  // Convenient aliases: { pat, token, secret }
  if (typeof body.pat === "string") {
    varsToSave[PROJECT_ENV_KEYS.AZURE_PAT] = body.pat;
  }
  if (typeof body.token === "string") {
    if (provider === "jira") {
      varsToSave[PROJECT_ENV_KEYS.JIRA_TOKEN] = body.token;
    } else {
      varsToSave[PROJECT_ENV_KEYS.GITHUB_TOKEN] = body.token;
    }
  }
  if (typeof body.secret === "string") {
    if (provider === "azure") {
      varsToSave[PROJECT_ENV_KEYS.AZURE_PAT] = body.secret;
    } else if (provider === "jira") {
      varsToSave[PROJECT_ENV_KEYS.JIRA_TOKEN] = body.secret;
    } else {
      varsToSave[PROJECT_ENV_KEYS.GITHUB_TOKEN] = body.secret;
    }
  }

  return varsToSave;
}

export interface TrackerTestResult {
  ok: boolean;
  message?: string | undefined;
  error?: string | undefined;
}

/**
 * Executes a live connection probe against Azure DevOps, Jira, or GitHub.
 */
export async function testProjectTrackerConnection(
  provider: IssueTrackerProvider,
  tracker: ProjectIssueTracker | undefined,
  env: Record<string, string>,
  bodyData: Record<string, unknown>,
  repositoryPath: string,
): Promise<TrackerTestResult> {
  if (provider === "azure") {
    const orgUrl = (bodyData.orgUrl as string) || tracker?.azure?.orgUrl;
    const azureProj =
      (bodyData.project as string) ||
      tracker?.azure?.project ||
      tracker?.projectId;
    const pat =
      (bodyData.pat as string) ||
      env[PROJECT_ENV_KEYS.AZURE_PAT] ||
      process.env.AZURE_DEVOPS_PAT;
    const input: { orgUrl?: string; project?: string; pat?: string } = {};
    if (orgUrl) input.orgUrl = orgUrl;
    if (azureProj) input.project = azureProj;
    if (pat) input.pat = pat;
    return testAzureConnection(input);
  }

  if (provider === "jira") {
    const host = (bodyData.host as string) || tracker?.jira?.host;
    const email = (bodyData.email as string) || tracker?.jira?.email;
    const token =
      (bodyData.token as string) ||
      env[PROJECT_ENV_KEYS.JIRA_TOKEN] ||
      process.env.JIRA_API_TOKEN;
    const jiraProj =
      (bodyData.project as string) ||
      tracker?.jira?.project ||
      tracker?.projectId;
    if (!host || !email || !token) {
      return {
        ok: false,
        error: "Jira host, email, and token are required.",
      };
    }
    try {
      await fetchJiraTickets({
        host,
        email,
        token,
        project: jiraProj,
        requiredLabel: "agentic-workflow",
      });
      return { ok: true, message: "Jira connection successful." };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  }

  if (provider === "github") {
    const repo = (bodyData.repo as string) || tracker?.github?.repo;
    const token =
      (bodyData.token as string) ||
      env[PROJECT_ENV_KEYS.GITHUB_TOKEN] ||
      process.env.GITHUB_TOKEN;
    try {
      await fetchGitHubTickets({
        repo,
        token,
        cwd: repositoryPath,
        requiredLabel: "agentic-workflow",
      });
      return {
        ok: true,
        message: "GitHub connection successful.",
      };
    } catch (err: unknown) {
      return { ok: false, error: (err as Error).message };
    }
  }

  return {
    ok: false,
    error: `Unsupported provider: ${provider}`,
  };
}

export interface ProjectMigrationInput {
  targetProvider: IssueTrackerProvider;
  name?: string | undefined;
  newProjectId?: string | undefined;
  azure?:
    | { orgUrl: string; project: string; requiredLabel?: string | undefined }
    | undefined;
  jira?:
    | {
        host: string;
        email: string;
        project: string;
        requiredLabel?: string | undefined;
      }
    | undefined;
  github?: { repo: string; requiredLabel?: string | undefined } | undefined;
  secrets?: { pat?: string; token?: string } | undefined;
}

export interface MigrationPlan {
  newId: string;
  newProject: Project;
  archivedOldProject: Project;
  secretsToSave: Record<string, string>;
}

/**
 * Builds the successor project model, archived predecessor model, and credentials mapping.
 */
export function buildProjectMigrationPlan(
  project: Project,
  body: ProjectMigrationInput,
): MigrationPlan {
  const newId =
    body.newProjectId?.trim() || `${project.id}-${body.targetProvider}`;

  const newIssueTracker: ProjectIssueTracker = {
    provider: body.targetProvider,
    connectionId: body.targetProvider,
    azure: body.targetProvider === "azure" ? body.azure : undefined,
    jira: body.targetProvider === "jira" ? body.jira : undefined,
    github: body.targetProvider === "github" ? body.github : undefined,
  };

  const newProject: Project = {
    ...project,
    id: newId,
    name: body.name?.trim() || project.name,
    issueTracker: newIssueTracker,
    archived: false,
    archivedAt: undefined,
    successorId: undefined,
    predecessorId: project.id,
  };

  const archivedOldProject: Project = {
    ...project,
    archived: true,
    archivedAt: new Date().toISOString(),
    successorId: newId,
  };

  const secretsToSave: Record<string, string> = {};
  if (body.secrets) {
    if (body.targetProvider === "azure" && body.secrets.pat) {
      secretsToSave[PROJECT_ENV_KEYS.AZURE_PAT] = body.secrets.pat;
    } else if (body.targetProvider === "jira" && body.secrets.token) {
      secretsToSave[PROJECT_ENV_KEYS.JIRA_TOKEN] = body.secrets.token;
    } else if (body.targetProvider === "github" && body.secrets.token) {
      secretsToSave[PROJECT_ENV_KEYS.GITHUB_TOKEN] = body.secrets.token;
    }
  }

  return {
    newId,
    newProject,
    archivedOldProject,
    secretsToSave,
  };
}
