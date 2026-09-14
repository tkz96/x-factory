// src/http/projects-controller.ts — Project CRUD, repository discovery, inspection, and readiness endpoints.

import { loadProjects, getProject, saveProject, deleteProject } from "../config.js";
import {
  discoverRepositories,
  extractAzureDevOpsInfo,
  type RepositoryDiscoveryInput,
} from "../discovery/index.js";
import { inspectLocalRepository, checkProjectReadiness } from "../inspection/index.js";
import { fetchProjectTickets } from "../trackers/index.js";
import { jsonResponse, errorResponse, parseJsonBody } from "./responses.js";

async function handleGetProjects(): Promise<Response> {
  const projects = await loadProjects();
  return jsonResponse(projects);
}

async function handleCreateProject(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for project creation.");
  }
  try {
    const saved = await saveProject(body);
    return jsonResponse(saved, 201);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 400);
  }
}

async function handleGetProject(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) {
    return errorResponse(`Project "${projectId}" not found.`, 404);
  }
  const readiness = await checkProjectReadiness(project);
  return jsonResponse({ ...project, readiness });
}

async function handleUpdateProject(projectId: string, req: Request): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) {
    return errorResponse(`Project "${projectId}" not found.`, 404);
  }
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for project update.");
  }
  try {
    const merged = { ...project, ...(body as Record<string, unknown>), id: projectId };
    const saved = await saveProject(merged);
    return jsonResponse(saved);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 400);
  }
}

async function handleDeleteProject(projectId: string): Promise<Response> {
  try {
    await deleteProject(projectId);
    return jsonResponse({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 404);
  }
}

function normalizeDiscoveryInput(input: RepositoryDiscoveryInput): void {
  if (input.primaryRepo && (input.provider === "azure" || input.provider === "azure-devops")) {
    const extracted = extractAzureDevOpsInfo(input.primaryRepo);
    if (!input.orgUrl && extracted.orgUrl) input.orgUrl = extracted.orgUrl;
    if (!input.project && extracted.project) input.project = extracted.project;
  }
}

async function handleDiscoverRepositories(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for discovery request.");
  }
  const input = body as unknown as RepositoryDiscoveryInput;
  if (!input.provider) {
    return errorResponse("Discovery provider is required ('azure', 'github', 'local').");
  }
  normalizeDiscoveryInput(input);
  try {
    const repos = await discoverRepositories(input);
    return jsonResponse({ repositories: repos });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 400);
  }
}

async function handleInspectRepository(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for repository inspection.");
  }
  const { path: repoPath, expectedRemote } = body as { path?: string; expectedRemote?: string };
  if (!repoPath || typeof repoPath !== "string") {
    return errorResponse("Repository path is required.");
  }
  try {
    const result = await inspectLocalRepository(repoPath, expectedRemote);
    return jsonResponse(result);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 400);
  }
}

async function handleGetProjectReadiness(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) {
    return errorResponse(`Project "${projectId}" not found.`, 404);
  }
  const readiness = await checkProjectReadiness(project);
  return jsonResponse(readiness);
}

async function handleGetProjectTickets(projectId: string): Promise<Response> {
  const project = await getProject(projectId);
  if (!project) {
    return errorResponse(`Project "${projectId}" not found.`, 404);
  }
  const tickets = await fetchProjectTickets(projectId);
  return jsonResponse(tickets);
}

async function handleProjectMemberCrud(
  method: string,
  id: string,
  req: Request
): Promise<Response | null> {
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
  if (action === "tickets") {
    return method === "GET" ? handleGetProjectTickets(id) : null;
  }
  if (action === "readiness") {
    return method === "GET" ? handleGetProjectReadiness(id) : null;
  }
  if (!action && partsCount === 2) {
    return handleProjectMemberCrud(method, id, req);
  }
  return null;
}

export async function handleProjectsRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  partsCount: number,
  req: Request
): Promise<Response | null> {
  // Discovery and inspection action endpoints (/api/projects/discover-repositories, etc.)
  if (id === "discover-repositories" && method === "POST") {
    return handleDiscoverRepositories(req);
  }
  if (id === "inspect-repository" && method === "POST") {
    return handleInspectRepository(req);
  }

  // Collection endpoints (/api/projects)
  if (!id) {
    if (method === "GET") return handleGetProjects();
    if (method === "POST") return handleCreateProject(req);
    return null;
  }

  // Member endpoints (/api/projects/:id or /api/projects/:id/:action)
  return handleProjectMemberRoute(method, id, action, partsCount, req);
}
