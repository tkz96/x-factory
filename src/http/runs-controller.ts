// src/http/runs-controller.ts — Execution run lifecycle, streaming events, and steering endpoints.

import { getProject } from "../config.js";
import * as runs from "../runs.js";
import {
  catchHttpErrors,
  createEventStreamResponse,
  errorResponse,
  jsonResponse,
  withValidatedBody,
} from "./responses.js";
import { CreateRunBodySchema, SteerRunBodySchema } from "./schemas.js";

export function parseAcceptanceCriteria(raw: unknown): string[] {
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
  return withValidatedBody(
    req,
    CreateRunBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        const projectId = body.projectId;
        const project = await getProject(projectId, true);
        if (!project) {
          return errorResponse(
            `Project "${projectId}" not found or inaccessible.`,
            404,
          );
        }

        const ticketId = body.ticketId || "";
        const ticketTitle = body.ticketTitle || ticketId;
        const plan = body.plan || "";
        const acceptanceCriteria = parseAcceptanceCriteria(
          body.acceptanceCriteria,
        );
        const description = body.description;
        const branch = body.branch;

        const run = await runs.createRun(
          project,
          ticketId,
          ticketTitle,
          plan,
          acceptanceCriteria,
          description,
          branch,
        );
        return jsonResponse(run, 201);
      }),
    "Invalid JSON in request body.",
  );
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
    runs.subscribe(runId, listener),
  );
}

async function handleSteerRun(req: Request, runId: string): Promise<Response> {
  return withValidatedBody(
    req,
    SteerRunBodySchema,
    async (body) => {
      await runs.steerRun(runId, body.message);
      return jsonResponse({ ok: true });
    },
    "Invalid JSON in request body.",
  );
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
  req: Request,
): Promise<Response | null> {
  if (method === "GET" && action === "events") {
    return handleRunEvents(runId);
  }
  if (method === "POST") {
    switch (action) {
      case "steer":
        return handleSteerRun(req, runId);
      case "stop":
        return handleStopRun(runId);
      case "pr":
        return handleCreatePR(runId);
    }
  }
  return null;
}

export async function handleRunsRoute(
  method: string,
  id: string | undefined,
  action: string | undefined,
  partsCount: number,
  req: Request,
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
