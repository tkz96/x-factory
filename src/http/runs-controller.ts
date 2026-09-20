// src/http/runs-controller.ts — Execution run lifecycle, streaming events, and steering endpoints.

import { getProject } from "../config.js";
import * as runs from "../runs.js";
import type { RunEvent } from "../shared/types.js";
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

function handleRunEvents(runId: string, req?: Request): Response {
  const run = runs.getRun(runId);
  if (!run) return errorResponse("Run not found.", 404);

  let sinceSequence: number | undefined;
  if (req) {
    const lastEventIdHeader = req.headers.get("last-event-id");
    if (lastEventIdHeader && !Number.isNaN(Number(lastEventIdHeader))) {
      sinceSequence = Number(lastEventIdHeader);
    } else {
      try {
        const url = new URL(req.url);
        const queryVal = url.searchParams.get("last_event_id");
        if (queryVal && !Number.isNaN(Number(queryVal))) {
          sinceSequence = Number(queryVal);
        }
      } catch {
        // ignore url parsing error
      }
    }
  }

  // Query durable events from SQLite (XFM-12, XFM-15)
  const durableEvents = runs.getRunEvents(runId, { sinceSequence });
  const initialEvents: (RunEvent | Record<string, unknown>)[] =
    durableEvents.length > 0
      ? durableEvents.map((e) => ({
          id: e.sequence,
          sequence: e.sequence,
          type: e.type,
          payload: e.payload,
          createdAt: e.createdAt,
        }))
      : run.events;

  return createEventStreamResponse(initialEvents, (listener) =>
    runs.subscribe(runId, listener),
  );
}

async function handleSteerRun(req: Request, runId: string): Promise<Response> {
  return withValidatedBody(
    req,
    SteerRunBodySchema,
    async (body) => {
      const commandId =
        body.commandId || (body as { command_id?: string }).command_id;
      const deduplicated = await runs.steerRun(runId, body.message, commandId);
      return jsonResponse({ ok: true, deduplicated });
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

async function handleResumeRun(runId: string): Promise<Response> {
  const run = await runs.resumeRun(runId);
  return jsonResponse({ ok: true, run });
}

async function handleAbandonRun(runId: string): Promise<Response> {
  const run = await runs.abandonRun(runId);
  return jsonResponse({ ok: true, run });
}

async function handleRunAction(
  action: string,
  method: string,
  runId: string,
  req: Request,
): Promise<Response | null> {
  if (method === "GET" && action === "events") {
    return handleRunEvents(runId, req);
  }
  if (method === "POST") {
    switch (action) {
      case "steer":
        return handleSteerRun(req, runId);
      case "stop":
        return handleStopRun(runId);
      case "pr":
        return handleCreatePR(runId);
      case "resume":
        return handleResumeRun(runId);
      case "abandon":
        return handleAbandonRun(runId);
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
