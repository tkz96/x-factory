// src/http/runs-controller.ts — Execution run lifecycle and streaming events.

import type { Repositories } from "../composition-root.js";
import { getProject } from "../config.js";
import * as runs from "../runs.js";
import { TERMINAL_RUN_STATUSES } from "../shared/run-status-policy.js";
import type {
  AbandonRunResponse,
  ChatWithRunResponse,
  CreateRunResponse,
  PrRunResponse,
  ResumeRunResponse,
  RunStatus,
  StopRunResponse,
  TransitionRunResponse,
} from "../shared/types.js";
import {
  catchHttpErrors,
  errorResponse,
  formatSSEMessage,
  jsonResponse,
  parseJsonBody,
  toWireEvent,
  withValidatedBody,
} from "./responses.js";
import {
  ChatRunBodySchema,
  CreateRunBodySchema,
  TransitionRunBodySchema,
} from "./schemas.js";
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

async function handleCreateRun(
  repos: Repositories,
  req: Request,
): Promise<Response> {
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
          repos,
          project,
          ticketId,
          ticketTitle,
          plan,
          acceptanceCriteria,
          description,
          branch,
        );
        return jsonResponse<CreateRunResponse>(run, 201);
      }),
    "Invalid JSON in request body.",
  );
}

function handleGetRuns(repos: Repositories): Response {
  return jsonResponse(runs.listRuns(repos));
}

function handleGetRun(repos: Repositories, runId: string): Response {
  const run = runs.getRun(repos, runId);
  if (!run) return errorResponse("Run not found.", 404);
  return jsonResponse(run);
}

function handleRunEvents(
  repos: Repositories,
  runId: string,
  req?: Request,
): Response {
  const run = runs.getRun(repos, runId);
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
          const events = runs.getRunEvents(repos, runId, {
            sinceSequence: lastSequence,
          });
          for (const event of events) {
            const wireEvent = toWireEvent(event);
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
          const currentRun = runs.getRun(repos, runId);
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

async function handleChatMessage(
  repos: Repositories,
  req: Request,
  runId: string,
): Promise<Response> {
  return withValidatedBody(
    req,
    ChatRunBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        const result = await runs.chatWithRun(repos, runId, body.message);
        return jsonResponse<ChatWithRunResponse>(result);
      }),
    "Invalid JSON in request body.",
  );
}

async function handleStopRun(
  repos: Repositories,
  runId: string,
): Promise<Response> {
  return catchHttpErrors(async () =>
    jsonResponse<StopRunResponse>({
      ok: true,
      run: await runs.stopRun(repos, runId),
    }),
  );
}

async function handleTransitions(
  repos: Repositories,
  req: Request,
  runId: string,
): Promise<Response> {
  return withValidatedBody(
    req,
    TransitionRunBodySchema,
    (body) =>
      catchHttpErrors(async () => {
        const run = await runs.handleTransition(
          repos,
          runId,
          body.action,
          body.payload,
        );
        return jsonResponse<TransitionRunResponse>({ ok: true, run });
      }),
    "Invalid JSON in request body.",
  );
}

async function handleCreatePR(
  repos: Repositories,
  runId: string,
): Promise<Response> {
  return catchHttpErrors(async () => {
    const result = await runs.createPR(repos, runId);
    return jsonResponse<PrRunResponse>(result);
  });
}

async function handleResumeRun(
  repos: Repositories,
  runId: string,
): Promise<Response> {
  return catchHttpErrors(async () => {
    const run = await runs.resumeRun(repos, runId);
    return jsonResponse<ResumeRunResponse>({ ok: true, run });
  });
}

async function handleAbandonRun(
  repos: Repositories,
  req: Request,
  runId: string,
): Promise<Response> {
  return catchHttpErrors(async () => {
    // The reason body is optional (#182): older clients POST with no body at
    // all, and a body that fails to parse simply abandons without a reason.
    const parsed = await parseJsonBody(req);
    const reason =
      parsed && typeof parsed.reason === "string" ? parsed.reason : undefined;
    const run = await runs.abandonRun(repos, runId, reason);
    return jsonResponse<AbandonRunResponse>({ ok: true, run });
  });
}

async function handleRunAction(
  repos: Repositories,
  action: string,
  method: string,
  runId: string,
  req: Request,
): Promise<Response | null> {
  if (method === "GET" && action === "events") {
    return handleRunEvents(repos, runId, req);
  }
  if (method === "POST") {
    switch (action) {
      case "chat":
        return handleChatMessage(repos, req, runId);
      case "transitions":
        return handleTransitions(repos, req, runId);
      case "stop":
        return handleStopRun(repos, runId);
      case "pr":
        return handleCreatePR(repos, runId);
      case "resume":
        return handleResumeRun(repos, runId);
      case "abandon":
        return handleAbandonRun(repos, req, runId);
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
  repos: Repositories,
): Promise<Response | null> {
  if (!id) {
    if (method === "GET") return handleGetRuns(repos);
    if (method === "POST") return handleCreateRun(repos, req);
    return null;
  }
  if (!action && partsCount === 2) {
    return method === "GET" ? handleGetRun(repos, id) : null;
  }
  if (action && partsCount === 3) {
    return handleRunAction(repos, action, method, id, req);
  }
  return null;
}
