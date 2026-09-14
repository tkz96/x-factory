import { loadProjects, getProject, saveProject, deleteProject } from "../config.js";
import {
  discoverRepositories,
  extractAzureDevOpsInfo,
  type RepositoryDiscoveryInput,
} from "../discovery/index.js";
import { inspectLocalRepository, checkProjectReadiness } from "../inspection/index.js";
import * as runs from "../runs.js";
import { fetchProjectTickets } from "../trackers.js";
import { loadSettings, saveSettings, type FactorySettings } from "../settings.js";
import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  createEventStreamResponse,
} from "./responses.js";

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

// fallow-ignore-next-line complexity
async function handleDiscoverRepositories(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for discovery request.");
  }
  const input = body as unknown as RepositoryDiscoveryInput;
  if (!input.provider) {
    return errorResponse("Discovery provider is required ('azure', 'github', 'local').");
  }
  if (input.primaryRepo && (input.provider === "azure" || input.provider === "azure-devops")) {
    const extracted = extractAzureDevOpsInfo(input.primaryRepo);
    if (!input.orgUrl && extracted.orgUrl) input.orgUrl = extracted.orgUrl;
    if (!input.project && extracted.project) input.project = extracted.project;
  }
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

async function handleGetSettings(): Promise<Response> {
  const settings = await loadSettings(true);
  return jsonResponse(settings);
}

async function handleUpdateSettings(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse("Invalid JSON for settings.");
  }
  const updated = await saveSettings(body as Partial<FactorySettings>);
  return jsonResponse(updated);
}



function parseAcceptanceCriteria(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw as string[];
  }
  if (typeof raw === "string") {
    return raw
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

async function handleCreateRun(req: Request): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body) {
    return errorResponse("Invalid JSON in request body.");
  }

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const project = await getProject(projectId, true);
  if (!project) {
    return errorResponse(`Project "${projectId}" not found or inaccessible.`, 404);
  }

  const ticketId = typeof body.ticketId === "string" ? body.ticketId : "";
  const ticketTitle = typeof body.ticketTitle === "string" ? body.ticketTitle : ticketId;
  const plan = typeof body.plan === "string" ? body.plan : "";
  const acceptanceCriteria = parseAcceptanceCriteria(body.acceptanceCriteria);
  const description = typeof body.description === "string" ? body.description : undefined;
  const branch = typeof body.branch === "string" ? body.branch : undefined;

  const run = await runs.createRun(
    project,
    ticketId,
    ticketTitle,
    plan,
    acceptanceCriteria,
    description,
    branch
  );
  return jsonResponse(run, 201);
}

function handleGetRuns(): Response {
  return jsonResponse(runs.listRuns());
}

function handleGetRun(runId: string): Response {
  const run = runs.getRun(runId);
  if (!run) return errorResponse("Run not found.", 404);
  return jsonResponse(run);
}

function handleRunEvents(runId: string): Response {
  const run = runs.getRun(runId);
  if (!run) return errorResponse("Run not found.", 404);

  return createEventStreamResponse(run.events, (listener) =>
    runs.subscribe(runId, listener)
  );
}

async function handleSteerRun(req: Request, runId: string): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body) {
    return errorResponse("Invalid JSON in request body.");
  }

  if (typeof body.message !== "string" || !body.message.trim()) {
    return errorResponse("Message is required.");
  }

  await runs.steerRun(runId, body.message.trim());
  return jsonResponse({ ok: true });
}

async function handleStopRun(runId: string): Promise<Response> {
  await runs.stopRun(runId);
  return jsonResponse({ ok: true });
}

async function handleCreatePR(runId: string): Promise<Response> {
  const pr = await runs.createPR(runId);
  return jsonResponse(pr);
}

async function handleRunAction(
  action: string,
  method: string,
  runId: string,
  req: Request
): Promise<Response | null> {
  if (method === "GET" && action === "events") {
    return handleRunEvents(runId);
  }
  if (method === "POST") {
    switch (action) {
      case "steer": return handleSteerRun(req, runId);
      case "stop": return handleStopRun(runId);
      case "pr": return handleCreatePR(runId);
    }
  }
  return null;
}

async function handleRunsRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  partsCount: number,
  req: Request
): Promise<Response | null> {
  if (!id) {
    if (method === "GET") return handleGetRuns();
    if (method === "POST") return handleCreateRun(req);
    return null;
  }
  if (!action && partsCount === 2) {
    return method === "GET" ? handleGetRun(id) : null;
  }
  if (action && partsCount === 3) {
    return handleRunAction(action, method, id, req);
  }
  return null;
}

// fallow-ignore-next-line complexity
async function handleProjectsRoute(
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

  // Member action endpoints (/api/projects/:id/:action)
  if (id && action === "tickets" && method === "GET") {
    return handleGetProjectTickets(id);
  }
  if (id && action === "readiness" && method === "GET") {
    return handleGetProjectReadiness(id);
  }

  // Member CRUD endpoints (/api/projects/:id)
  if (id && !action && partsCount === 2) {
    if (method === "GET") return handleGetProject(id);
    if (method === "PATCH" || method === "PUT") return handleUpdateProject(id, req);
    if (method === "DELETE") return handleDeleteProject(id);
  }

  return null;
}

function handleSettingsRoute(method: string, req: Request): Promise<Response> | null {
  if (method === "GET") return handleGetSettings();
  if (method === "POST") return handleUpdateSettings(req);
  return null;
}

async function routeApiRequest(
  method: string,
  parts: string[],
  req: Request
): Promise<Response | null> {
  const [resource, id, action] = parts;
  if (resource === "projects") return handleProjectsRoute(method, id, action, parts.length, req);
  if (resource === "runs") return handleRunsRoute(method, id, action, parts.length, req);
  if (resource === "settings") return handleSettingsRoute(method, req);
  return null;
}


export async function handleApi(req: Request, url: URL): Promise<Response> {
  const method = req.method;
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);

  try {
    const response = await routeApiRequest(method, parts, req);
    return response || errorResponse("Endpoint not found.", 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`API Error [${method} ${url.pathname}]:`, message);
    return errorResponse(message, 500);
  }
}
