// src/http/runs-controller.ts — Execution run lifecycle, streaming events, and steering endpoints.

import { getProject } from "../config.js";
import * as runs from "../runs.js";
import {
  jsonResponse,
  errorResponse,
  parseJsonBody,
  createEventStreamResponse,
} from "./responses.js";

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

export async function handleRunsRoute(
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
