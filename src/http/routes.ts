// src/http/routes.ts — REST API routing and endpoint controllers for X-Factory.

import { loadProjects, getProject } from "../config.js";
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

function handleProjectsRoute(
  method: string,
  id?: string,
  action?: string
): Promise<Response> | null {
  if (!id && method === "GET") return handleGetProjects();
  if (id && action === "tickets" && method === "GET") return handleGetProjectTickets(id);
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
  if (resource === "projects") return handleProjectsRoute(method, id, action);
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
