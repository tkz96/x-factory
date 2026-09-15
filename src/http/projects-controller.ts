import { stat, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjects, getProject, saveProject, deleteProject } from "../config.js";
import {
  discoverRepositories,
  extractAzureDevOpsInfo,
  type RepositoryDiscoveryInput,
} from "../discovery/index.js";
import { getAzureCliAuthHeader } from "../discovery/azure.js";
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

function cleanPat(input: RepositoryDiscoveryInput): void {
  if (typeof input.pat === "string" && !input.pat.trim()) {
    input.pat = undefined;
  }
}

function fillAzureDefaults(input: RepositoryDiscoveryInput): void {
  const isAzure = input.provider === "azure" || input.provider === "azure-devops";
  if (!isAzure || !input.primaryRepo) return;
  const extracted = extractAzureDevOpsInfo(input.primaryRepo);
  input.orgUrl = input.orgUrl || extracted.orgUrl;
  input.project = input.project || extracted.project;
}

function normalizeDiscoveryInput(input: RepositoryDiscoveryInput): void {
  cleanPat(input);
  fillAzureDefaults(input);
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

function expandUserPath(inputPath: string): string {
  return inputPath.startsWith("~")
    ? path.join(os.homedir(), inputPath.slice(1))
    : path.resolve(inputPath);
}

async function scanGitSubdirs(parentDir: string): Promise<string[]> {
  try {
    const entries = await readdir(parentDir, { withFileTypes: true });
    const repos: string[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      try {
        const dotGit = await stat(path.join(parentDir, ent.name, ".git"));
        if (dotGit.isDirectory() || dotGit.isFile()) repos.push(ent.name);
      } catch {
        // ignore non-git subdirectories
      }
    }
    return repos;
  } catch {
    return [];
  }
}

async function handleCheckPath(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  const inputPath = typeof body === "object" && body ? String((body as { path?: string }).path || "").trim() : "";
  if (!inputPath) return errorResponse("Path is required.");

  const expanded = expandUserPath(inputPath);
  try {
    const s = await stat(expanded);
    if (!s.isDirectory()) {
      return jsonResponse({ exists: false, resolvedPath: expanded, isDirectory: false, error: "Path is not a directory." });
    }
    const gitRepos = await scanGitSubdirs(expanded);
    return jsonResponse({ exists: true, resolvedPath: expanded, isDirectory: true, gitRepos, gitRepoCount: gitRepos.length });
  } catch {
    return jsonResponse({ exists: false, resolvedPath: expanded, error: "Directory does not exist." });
  }
}

async function resolveAzureAuth(pat?: string): Promise<{ authHeader: string; authMethod: string }> {
  if (pat) {
    const header = pat.startsWith("eyJ") ? `Bearer ${pat}` : `Basic ${Buffer.from(`:${pat}`).toString("base64")}`;
    return { authHeader: header, authMethod: "Personal Access Token" };
  }
  const cliHeader = await getAzureCliAuthHeader();
  return { authHeader: cliHeader, authMethod: cliHeader ? "Active Azure CLI Session" : "" };
}

async function fetchAzureRepoNames(apiUrl: string, authHeader: string): Promise<string[]> {
  const res = await fetch(apiUrl, { headers: { Authorization: authHeader, Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`Azure responded with status ${res.status}: ${await res.text()}`);
  }
  const resData = (await res.json()) as { value?: Array<{ id: string; name: string }> };
  return (resData.value || []).map((r) => r.name);
}

function parseAzureTarget(data: { orgUrl?: string; project?: string }): { orgUrl: string; project: string } | null {
  const parsed = extractAzureDevOpsInfo(data.project || data.orgUrl);
  const orgUrl = (data.orgUrl || parsed.orgUrl || "").trim().replace(/\/+$/, "");
  const project = (parsed.project || data.project || "").trim();
  return orgUrl && project ? { orgUrl, project } : null;
}

async function testAzureConnection(data: { orgUrl?: string; project?: string; pat?: string }): Promise<Response> {
  const target = parseAzureTarget(data);
  if (!target) {
    return jsonResponse({
      ok: false,
      provider: "azure",
      error: "Both Azure Organization URL and Project Name are required (e.g. dev.azure.com/xynotech/Converso).",
    });
  }

  const { authHeader, authMethod } = await resolveAzureAuth((data.pat || "").trim());
  if (!authHeader) {
    return jsonResponse({
      ok: false,
      provider: "azure",
      error: "Authentication required. Please enter an Azure PAT or log in via Azure CLI ('az login').",
    });
  }

  try {
    const apiUrl = `${target.orgUrl}/${encodeURIComponent(target.project)}/_apis/git/repositories?api-version=7.1`;
    const repos = await fetchAzureRepoNames(apiUrl, authHeader);
    return jsonResponse({
      ok: true,
      provider: "azure",
      organization: target.orgUrl,
      project: target.project,
      repoCount: repos.length,
      repositories: repos,
      authMethod,
      message: `Successfully connected to Azure DevOps (${target.project}) via ${authMethod}. Found ${repos.length} repositories.`,
    });
  } catch (err) {
    return jsonResponse({ ok: false, provider: "azure", error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleTestConnection(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") return errorResponse("Invalid JSON for connection test.");
  const data = body as { provider?: string; orgUrl?: string; project?: string; pat?: string };
  if ((data.provider || "azure") === "azure") {
    return testAzureConnection(data);
  }
  return jsonResponse({ ok: true, provider: data.provider, message: "Connection parameters accepted." });
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
  if (id === "test-connection" && method === "POST") {
    return handleTestConnection(req);
  }
  if (id === "check-path" && method === "POST") {
    return handleCheckPath(req);
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
