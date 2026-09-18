// src/http/projects-controller.ts — Multi-repository project CRUD, onboarding, tracker secrets, and migration endpoints.

import { stat } from "node:fs/promises";
import { testAzureConnection } from "../azure/connection.js";
import { testAzurePatScopes } from "../azure/scopes.js";
import {
  deleteProject,
  getProject,
  loadProjects,
  saveProject,
} from "../config.js";
import {
  discoverRepositories,
  type RepositoryDiscoveryInput,
} from "../discovery/index.js";
import {
  checkProjectReadiness,
  inspectLocalRepository,
} from "../inspection/index.js";
import { expandUserPath, scanGitSubdirectories } from "../paths.js";
import {
  loadProjectEnv,
  PROJECT_ENV_KEYS,
  saveProjectEnv,
} from "../project-env.js";
import { maskSecret } from "../settings.js";
import { defaultRunStore } from "../store.js";
import {
  fetchGitHubTickets,
  fetchJiraTickets,
  fetchProjectTickets,
} from "../trackers/index.js";
import type {
  IssueTrackerProvider,
  Project,
  ProjectIssueTracker,
} from "../types.js";
import {
  catchHttpErrors,
  errorResponse,
  jsonResponse,
  withJsonBody,
  withValidatedBody,
} from "./responses.js";
import { SaveProjectBodySchema, UpdateProjectBodySchema } from "./schemas.js";

async function handleGetProjects(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "true";
  const projects = await loadProjects();
  const filtered = includeArchived
    ? projects
    : projects.filter((p) => !p.archived);
  return jsonResponse(filtered);
}

async function handleCreateProject(req: Request): Promise<Response> {
  return withValidatedBody(
    req,
    SaveProjectBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        const saved = await saveProject(body);
        return jsonResponse(saved, 201);
      }),
    "Invalid JSON for project creation.",
  );
}

async function handleGetProject(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const readiness = await checkProjectReadiness(project);
  return jsonResponse({ ...project, readiness });
}

async function handleUpdateProject(
  projectId: string,
  req: Request,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  return withValidatedBody(
    req,
    UpdateProjectBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        const merged = {
          ...project,
          ...body,
          id: projectId,
        };
        const saved = await saveProject(merged);
        return jsonResponse(saved);
      }),
    "Invalid JSON for project update.",
  );
}

async function handleDeleteProject(projectId: string): Promise<Response> {
  return catchHttpErrors(async () => {
    await deleteProject(projectId);
    return jsonResponse({ ok: true });
  }, 404);
}

async function handleDiscoverRepositories(req: Request): Promise<Response> {
  return withJsonBody<RepositoryDiscoveryInput>(
    req,
    (body) =>
      catchHttpErrors(async () => {
        const repos = await discoverRepositories(body);
        return jsonResponse({
          provider: body.provider,
          repositories: repos,
        });
      }),
    "Invalid JSON for repository discovery.",
  );
}

async function handleInspectRepository(req: Request): Promise<Response> {
  return withJsonBody<{ path?: string }>(
    req,
    async ({ path: repoPath }) => {
      if (!repoPath || typeof repoPath !== "string") {
        return errorResponse("Repository path is required.");
      }
      return catchHttpErrors(async () => {
        const result = await inspectLocalRepository(repoPath);
        const status = !result.exists
          ? "error"
          : !result.isGitRepo
            ? "pending_setup"
            : "ready";
        const message =
          result.exists && result.isGitRepo
            ? "Ready"
            : result.exists
              ? "Pending Git init"
              : "Directory missing";
        return jsonResponse({
          ...result,
          readiness: {
            status,
            message,
          },
        });
      });
    },
    "Invalid JSON for repository inspection.",
  );
}

async function handleGetProjectReadiness(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const readiness = await checkProjectReadiness(project);
  return jsonResponse(readiness);
}

async function handleGetProjectTickets(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  if (project.archived) {
    return errorResponse(
      `Project "${projectId}" is archived. Ticket fetching is disabled.`,
      400,
    );
  }
  const tickets = await fetchProjectTickets(projectId);
  return jsonResponse(tickets);
}

async function handleGetProjectTracker(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const tracker = project.issueTracker;
  const provider = (tracker?.provider ||
    tracker?.connectionId ||
    "github") as IssueTrackerProvider;
  const env = await loadProjectEnv(projectId);

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

  return jsonResponse({
    provider,
    config: tracker?.[provider] || {},
    hasSecret,
    secretMask,
    secretKey,
  });
}

async function handleUpdateProjectTrackerCredentials(
  projectId: string,
  req: Request,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  return withJsonBody<Record<string, string>>(
    req,
    async (body) => {
      const provider =
        project.issueTracker?.provider ||
        project.issueTracker?.connectionId ||
        "github";
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

      // Also support convenient aliases { pat, token, secret }
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

      await saveProjectEnv(projectId, varsToSave);
      return jsonResponse({ ok: true, message: "Credentials updated." });
    },
    "Invalid JSON for tracker credentials.",
  );
}

async function handleTestProjectTracker(
  projectId: string,
  req: Request,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  let bodyData: Record<string, unknown> = {};
  try {
    bodyData = (await req.json()) as Record<string, unknown>;
  } catch {
    // optional body
  }

  const tracker = project.issueTracker;
  const provider = (bodyData.provider ||
    tracker?.provider ||
    tracker?.connectionId ||
    "github") as IssueTrackerProvider;
  const env = await loadProjectEnv(projectId);

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
    const result = await testAzureConnection(input);
    return jsonResponse(result);
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
      return jsonResponse({
        ok: false,
        error: "Jira host, email, and token are required.",
      });
    }
    try {
      await fetchJiraTickets({
        host,
        email,
        token,
        project: jiraProj,
        requiredLabel: "agentic-workflow",
      });
      return jsonResponse({ ok: true, message: "Jira connection successful." });
    } catch (err: unknown) {
      return jsonResponse({ ok: false, error: (err as Error).message });
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
        cwd: project.repositoryPath,
        requiredLabel: "agentic-workflow",
      });
      return jsonResponse({
        ok: true,
        message: "GitHub connection successful.",
      });
    } catch (err: unknown) {
      return jsonResponse({ ok: false, error: (err as Error).message });
    }
  }

  return jsonResponse({
    ok: false,
    error: `Unsupported provider: ${provider}`,
  });
}

async function handleMigrateProject(
  projectId: string,
  req: Request,
): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  if (project.archived) {
    return errorResponse(`Project "${projectId}" is already archived.`, 400);
  }

  // Active run guard
  const runs = defaultRunStore.list();
  const activeRun = runs.find(
    (r) =>
      r.project.id === projectId &&
      !["pr_created", "failed", "stopped"].includes(r.status),
  );
  if (activeRun) {
    return errorResponse(
      "Cannot migrate project while active runs are executing. Please wait for them to finish or stop them manually.",
      409,
    );
  }

  return withJsonBody<{
    targetProvider: IssueTrackerProvider;
    name?: string;
    newProjectId?: string;
    azure?: { orgUrl: string; project: string; requiredLabel?: string };
    jira?: {
      host: string;
      email: string;
      project: string;
      requiredLabel?: string;
    };
    github?: { repo: string; requiredLabel?: string };
    secrets?: { pat?: string; token?: string };
  }>(
    req,
    async (body) => {
      if (!body.targetProvider) {
        return errorResponse("targetProvider is required.", 400);
      }

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

      await saveProject(archivedOldProject);
      const savedNewProject = await saveProject(newProject);

      if (body.secrets) {
        const secretsToSave: Record<string, string> = {};
        if (body.targetProvider === "azure" && body.secrets.pat) {
          secretsToSave[PROJECT_ENV_KEYS.AZURE_PAT] = body.secrets.pat;
        } else if (body.targetProvider === "jira" && body.secrets.token) {
          secretsToSave[PROJECT_ENV_KEYS.JIRA_TOKEN] = body.secrets.token;
        } else if (body.targetProvider === "github" && body.secrets.token) {
          secretsToSave[PROJECT_ENV_KEYS.GITHUB_TOKEN] = body.secrets.token;
        }
        if (Object.keys(secretsToSave).length > 0) {
          await saveProjectEnv(newId, secretsToSave);
        }
      }

      return jsonResponse(
        {
          ok: true,
          archivedProjectId: project.id,
          predecessorId: project.id,
          newProjectId: newId,
          project: savedNewProject,
          migratedProject: savedNewProject,
        },
        201,
      );
    },
    "Invalid JSON for project migration.",
  );
}

async function handleProjectMemberCrud(
  method: string,
  id: string,
  req: Request,
): Promise<Response | null> {
  switch (method) {
    case "GET":
      return handleGetProject(id);
    case "PATCH":
    case "PUT":
      return handleUpdateProject(id, req);
    case "DELETE":
      return handleDeleteProject(id);
    default:
      return null;
  }
}

async function handleProjectMemberRoute(
  method: string,
  id: string,
  action: string | undefined,
  subaction: string | undefined,
  partsCount: number,
  req: Request,
): Promise<Response | null> {
  if (action === "tickets" && method === "GET") {
    return handleGetProjectTickets(id);
  }
  if (action === "readiness" && method === "GET") {
    return handleGetProjectReadiness(id);
  }
  if (action === "tracker") {
    if (!subaction && method === "GET") {
      return handleGetProjectTracker(id);
    }
    if (
      subaction === "credentials" &&
      (method === "PUT" || method === "POST")
    ) {
      return handleUpdateProjectTrackerCredentials(id, req);
    }
    if (subaction === "test" && method === "POST") {
      return handleTestProjectTracker(id, req);
    }
  }
  if (action === "migrate" && method === "POST") {
    return handleMigrateProject(id, req);
  }
  if (!action && partsCount === 2) {
    return handleProjectMemberCrud(method, id, req);
  }
  return null;
}

async function handleCheckPath(req: Request): Promise<Response> {
  return withJsonBody<{ path?: string }>(
    req,
    async ({ path: rawPath }) => {
      const inputPath = typeof rawPath === "string" ? rawPath.trim() : "";
      if (!inputPath) return errorResponse("Path is required.");

      const expanded = expandUserPath(inputPath);
      try {
        const s = await stat(expanded);
        if (!s.isDirectory()) {
          return jsonResponse({
            exists: false,
            existsLocally: false,
            resolvedPath: expanded,
            isDirectory: false,
            error: "Path is not a directory.",
          });
        }
        const gitRepos = await scanGitSubdirectories(expanded);
        return jsonResponse({
          exists: true,
          existsLocally: true,
          resolvedPath: expanded,
          isDirectory: true,
          gitRepos,
          gitRepoCount: gitRepos.length,
        });
      } catch {
        return jsonResponse({
          exists: false,
          existsLocally: false,
          resolvedPath: expanded,
          error: "Directory does not exist.",
        });
      }
    },
    "Invalid JSON for path check.",
  );
}

async function handleTestConnection(req: Request): Promise<Response> {
  return withJsonBody<{
    provider?: string;
    orgUrl?: string;
    project?: string;
    pat?: string;
    validateScopes?: boolean;
  }>(
    req,
    async (data) => {
      if ((data.provider || "azure") === "azure") {
        const result = await testAzureConnection(data);
        if (data.validateScopes || data.pat?.trim()) {
          const scopeResult = await testAzurePatScopes({
            orgUrl: data.orgUrl,
            project: data.project,
            pat: data.pat,
          });
          return jsonResponse({
            ...result,
            ok: result.ok && scopeResult.ok,
            scopes: scopeResult.scopes,
            overPrivileged: scopeResult.overPrivileged,
            scopeErrors: scopeResult.errors,
            scopeWarnings: scopeResult.warnings,
            warnings: scopeResult.warnings,
            error: !result.ok
              ? result.error
              : !scopeResult.ok
                ? `Scope verification failed: ${scopeResult.errors.join(" ")}`
                : undefined,
          });
        }
        return jsonResponse(result);
      }
      return jsonResponse({
        ok: true,
        provider: data.provider,
        message: "Connection parameters accepted.",
      });
    },
    "Invalid JSON for connection test.",
  );
}

async function handleTestAzureScopes(req: Request): Promise<Response> {
  return withJsonBody<{
    orgUrl?: string;
    project?: string;
    pat?: string;
  }>(
    req,
    async (data) => {
      const scopeResult = await testAzurePatScopes({
        orgUrl: data.orgUrl,
        project: data.project,
        pat: data.pat,
      });
      return jsonResponse(scopeResult);
    },
    "Invalid JSON for scope verification.",
  );
}

export async function handleProjectsRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  subactionOrPartsCount: string | number | undefined,
  partsCountOrReq: number | Request,
  maybeReq?: Request,
): Promise<Response | null> {
  let subaction: string | undefined;
  let partsCount: number;
  let req: Request;

  if (typeof subactionOrPartsCount === "number") {
    subaction = undefined;
    partsCount = subactionOrPartsCount;
    req = partsCountOrReq as Request;
  } else {
    subaction = subactionOrPartsCount;
    partsCount = typeof partsCountOrReq === "number" ? partsCountOrReq : 0;
    req = maybeReq as Request;
  }

  const isDiscover =
    id === "discover-repositories" ||
    id === "discover" ||
    id === "repositories";
  if (isDiscover && method === "POST") return handleDiscoverRepositories(req);

  const isInspect =
    id === "inspect-repository" || id === "quick-inspect" || id === "inspect";
  if (isInspect && method === "POST") return handleInspectRepository(req);

  const isTest = id === "test-connection" || id === "test-tracker";
  if (isTest && method === "POST") return handleTestConnection(req);

  const isTestScopes = id === "test-azure-scopes";
  if (isTestScopes && method === "POST") return handleTestAzureScopes(req);

  const isCheckPath = id === "check-path" || id === "validate-path";
  if (isCheckPath && method === "POST") return handleCheckPath(req);

  if (!id) {
    if (method === "GET") return handleGetProjects(req);
    if (method === "POST") return handleCreateProject(req);
    return null;
  }

  return handleProjectMemberRoute(
    method,
    id,
    action,
    subaction,
    partsCount,
    req,
  );
}
