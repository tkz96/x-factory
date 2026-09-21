// src/http/runs-controller.ts — Execution run lifecycle, streaming events, and steering endpoints.

import { getProject } from "../config.js";
import * as runs from "../runs.js";
import type { RunStatus } from "../shared/types.js";
import { TERMINAL_RUN_STATUSES } from "../state-machine.js";
import {
  catchHttpErrors,
  errorResponse,
  formatSSEMessage,
  jsonResponse,
  type WireSSEEvent,
  withValidatedBody,
} from "./responses.js";
import { CreateRunBodySchema, SteerRunBodySchema } from "./schemas.js";
import { defaultSSERegistry } from "./sse-registry.js";

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

  let initialSequence = 0;
  if (req) {
    const lastEventIdHeader = req.headers.get("last-event-id");
    if (lastEventIdHeader && !Number.isNaN(Number(lastEventIdHeader))) {
      initialSequence = Number(lastEventIdHeader);
    } else {
      try {
        const url = new URL(req.url);
        const queryVal = url.searchParams.get("last_event_id");
        if (queryVal && !Number.isNaN(Number(queryVal))) {
          initialSequence = Number(queryVal);
        }
      } catch {
        // ignore url parsing error
      }
    }
  }

  let lastSequence = initialSequence;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;
  let unregisterRegistry: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const cleanup = () => {
        if (isClosed) return;
        isClosed = true;
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        if (unregisterRegistry) {
          unregisterRegistry();
          unregisterRegistry = null;
        }
      };

      unregisterRegistry = defaultSSERegistry.register(() => {
        cleanup();
        try {
          controller.close();
        } catch {
          // ignore already closed
        }
      });

      const pollEvents = () => {
        if (isClosed) return;
        try {
          const events = runs.getRunEvents(runId, {
            sinceSequence: lastSequence,
          });
          for (const event of events) {
            const wireEvent: WireSSEEvent = {
              id: event.sequence,
              type: event.type,
              payload: event.payload,
              timestamp: event.createdAt,
            };
            controller.enqueue(encoder.encode(formatSSEMessage(wireEvent)));
            lastSequence = event.sequence;

            if (event.type === "status") {
              const payload = event.payload as { status?: string } | null;
              if (
                payload?.status &&
                TERMINAL_RUN_STATUSES.has(payload.status as RunStatus)
              ) {
                cleanup();
                try {
                  controller.close();
                } catch {
                  // ignore
                }
                return;
              }
            }
          }

          // If no new events and run was already terminal
          const currentRun = runs.getRun(runId);
          if (
            currentRun &&
            TERMINAL_RUN_STATUSES.has(currentRun.status) &&
            events.length === 0
          ) {
            cleanup();
            try {
              controller.close();
            } catch {
              // ignore
            }
          }
        } catch {
          cleanup();
          try {
            controller.close();
          } catch {
            // ignore
          }
        }
      };

      // Initial catch-up replay
      pollEvents();

      if (!isClosed) {
        // Poll SQLite every 300ms (Phase 2, Section 35)
        pollTimer = setInterval(pollEvents, 300);

        // Keepalive every 15s (Phase 2, Section 38)
        keepaliveTimer = setInterval(() => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          } catch {
            cleanup();
            try {
              controller.close();
            } catch {
              // ignore
            }
          }
        }, 15000);
      }
    },
    cancel() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
      if (unregisterRegistry) {
        unregisterRegistry();
        unregisterRegistry = null;
      }
      isClosed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
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
  const result = await runs.createPR(runId);
  return jsonResponse(result);
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
