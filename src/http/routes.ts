// src/http/routes.ts — REST API routing and endpoint controllers for X-Factory.

import { loadProjects, getProject } from "../config.js";
import * as runs from "../runs.js";
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

  const run = await runs.createRun(
    project,
    ticketId,
    ticketTitle,
    plan,
    acceptanceCriteria,
    description
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
  if (method === "POST") {
    switch (action) {
      case "steer": return handleSteerRun(req, runId);
      case "stop": return handleStopRun(runId);
      case "pr": return handleCreatePR(runId);
    }
  }
  if (method === "GET" && action === "events") {
    return handleRunEvents(runId);
  }
  return null;
}

async function handleRunsRoute(
  method: string,
  parts: string[],
  req: Request
): Promise<Response | null> {
  switch (parts.length) {
    case 1:
      if (method === "GET") return handleGetRuns();
      if (method === "POST") return handleCreateRun(req);
      return null;
    case 2:
      if (method === "GET" && parts[1] !== "events") {
        return handleGetRun(parts[1]);
      }
      return null;
    case 3:
      return handleRunAction(parts[2], method, parts[1], req);
    default:
      return null;
  }
}

async function routeApiRequest(
  method: string,
  parts: string[],
  req: Request
): Promise<Response | null> {
  const resource = parts[0];
  if (resource === "projects" && parts.length === 1 && method === "GET") {
    return handleGetProjects();
  }
  if (resource === "runs") {
    return handleRunsRoute(method, parts, req);
  }
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
