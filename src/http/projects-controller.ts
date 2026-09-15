// src/http/projects-controller.ts — Multi-repository project CRUD and onboarding API endpoints.

import { stat } from "node:fs/promises";
import { loadProjects, getProject, saveProject, deleteProject } from "../config.js";
import {
  discoverRepositories,
  extractAzureDevOpsInfo,
  type RepositoryDiscoveryInput,
} from "../discovery/index.js";
import { testAzureConnection } from "../azure/connection.js";
import { inspectLocalRepository, checkProjectReadiness } from "../inspection/index.js";
import { fetchProjectTickets } from "../trackers/index.js";
import { expandUserPath, scanGitSubdirectories } from "../paths.js";
import { jsonResponse, errorResponse, withJsonBody, catchHttpErrors } from "./responses.js";

async function handleGetProjects(): Promise<Response> {
  return jsonResponse(await loadProjects());
}

async function handleCreateProject(req: Request): Promise<Response> {
  return withJsonBody(req, (body) => catchHttpErrors(async () => {
    const saved = await saveProject(body);
    return jsonResponse(saved, 201);
  }), "Invalid JSON for project creation.");
}

async function handleGetProject(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);
  const readiness = await checkProjectReadiness(project);
  return jsonResponse({ ...project, readiness });
}

async function handleUpdateProject(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) return errorResponse(`Project "${projectId}" not found.`, 404);

  return withJsonBody(req, (body) => catchHttpErrors(async () => {
    const merged = { ...project, ...(body as Record<string, unknown>), id: projectId };
    const saved = await saveProject(merged);
    return jsonResponse(saved);
  }), "Invalid JSON for project update.");
}

async function handleDeleteProject(projectId: string): Promise<Response> {
  return catchHttpErrors(async () => {
    await deleteProject(projectId);
    return jsonResponse({ ok: true });
  }, 404);
}

function normalizeDiscoveryInput(input: RepositoryDiscoveryInput): void {
  if (typeof input.pat === "string" && !input.pat.trim()) {
    input.pat = undefined;
  }
  const isAzure = input.provider === "azure" || input.provider === "azure-devops";
  if (isAzure && input.primaryRepo) {
    const extracted = extractAzureDevOpsInfo(input.primaryRepo);
    input.orgUrl = input.orgUrl || extracted.orgUrl;
    input.project = input.project || extracted.project;
  }
}

async function handleDiscoverRepositories(req: Request): Promise<Response> {
  return withJsonBody<RepositoryDiscoveryInput>(req, (input) => {
    if (!input.provider) {
      return Promise.resolve(errorResponse("Discovery provider is required ('azure', 'github', 'local')."));
    }
    normalizeDiscoveryInput(input);
    return catchHttpErrors(async () => {
      const repos = await discoverRepositories(input);
      return jsonResponse({ repositories: repos });
    });
  }, "Invalid JSON for discovery request.");
}

async function handleInspectRepository(req: Request): Promise<Response> {
  return withJsonBody<{ path?: string; expectedRemote?: string }>(req, ({ path: repoPath, expectedRemote }) => {
    if (!repoPath || typeof repoPath !== "string") {
      return Promise.resolve(errorResponse("Repository path is required."));
    }
    return catchHttpErrors(async () => {
      const result = await inspectLocalRepository(repoPath, expectedRemote);
      return jsonResponse(result);
    });
  }, "Invalid JSON for repository inspection.");
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
  const tickets = await fetchProjectTickets(projectId);
  return jsonResponse(tickets);
}

async function handleProjectMemberCrud(method: string, id: string, req: Request): Promise<Response | null> {
  switch (method) {
    case "GET": return handleGetProject(id);
    case "PATCH":
    case "PUT": return handleUpdateProject(id, req);
    case "DELETE": return handleDeleteProject(id);
    default: return null;
  }
}

async function handleProjectMemberRoute(
  method: string,
  id: string,
  action: string | undefined,
  partsCount: number,
  req: Request
): Promise<Response | null> {
  if (action === "tickets") return method === "GET" ? handleGetProjectTickets(id) : null;
  if (action === "readiness") return method === "GET" ? handleGetProjectReadiness(id) : null;
  if (!action && partsCount === 2) return handleProjectMemberCrud(method, id, req);
  return null;
}

async function handleCheckPath(req: Request): Promise<Response> {
  return withJsonBody<{ path?: string }>(req, async ({ path: rawPath }) => {
    const inputPath = typeof rawPath === "string" ? rawPath.trim() : "";
    if (!inputPath) return errorResponse("Path is required.");

    const expanded = expandUserPath(inputPath);
    try {
      const s = await stat(expanded);
      if (!s.isDirectory()) {
        return jsonResponse({ exists: false, resolvedPath: expanded, isDirectory: false, error: "Path is not a directory." });
      }
      const gitRepos = await scanGitSubdirectories(expanded);
      return jsonResponse({ exists: true, resolvedPath: expanded, isDirectory: true, gitRepos, gitRepoCount: gitRepos.length });
    } catch {
      return jsonResponse({ exists: false, resolvedPath: expanded, error: "Directory does not exist." });
    }
  }, "Invalid JSON for path check.");
}

async function handleTestConnection(req: Request): Promise<Response> {
  return withJsonBody<{ provider?: string; orgUrl?: string; project?: string; pat?: string }>(
    req,
    async (data) => {
      if ((data.provider || "azure") === "azure") {
        const result = await testAzureConnection(data);
        return jsonResponse(result);
      }
      return jsonResponse({ ok: true, provider: data.provider, message: "Connection parameters accepted." });
    },
    "Invalid JSON for connection test."
  );
}

export async function handleProjectsRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  partsCount: number,
  req: Request
): Promise<Response | null> {
  if (id === "discover-repositories" && method === "POST") return handleDiscoverRepositories(req);
  if (id === "inspect-repository" && method === "POST") return handleInspectRepository(req);
  if (id === "test-connection" && method === "POST") return handleTestConnection(req);
  if (id === "check-path" && method === "POST") return handleCheckPath(req);

  if (!id) {
    if (method === "GET") return handleGetProjects();
    if (method === "POST") return handleCreateProject(req);
    return null;
  }

  return handleProjectMemberRoute(method, id, action, partsCount, req);
}
