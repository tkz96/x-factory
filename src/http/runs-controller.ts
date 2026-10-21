// src/http/runs-controller.ts — Execution run lifecycle and streaming events.

import type { Repositories } from "../composition-root.js";
import { getProject } from "../config.js";
import { assertRolesReady, ModelUnavailableError } from "../model-roles.js";
import * as runs from "../runs.js";
import { isReservedRunBranch } from "../shared/branch-name.js";
import { normalizeCriterion } from "../shared/normalization.js";
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
  errorResponse,
  formatSSEMessage,
  jsonResponse,
  parseJsonBody,
  toWireEvent,
  validateAgainstSchema,
  withValidatedBody,
} from "./responses.js";
import {
  AbandonRunBodySchema,
  ChatRunBodySchema,
  CreateRunBodySchema,
  TransitionRunBodySchema,
} from "./schemas.js";
import { defaultSSERegistry } from "./sse-registry.js";
import { SSE_KEEPALIVE_MS } from "./sse-timing.js";

export function parseAcceptanceCriteria(raw: unknown): string[] {
  const lines = Array.isArray(raw)
    ? raw.filter((c): c is string => typeof c === "string")
    : typeof raw === "string"
      ? raw.split("\n")
      : [];
  return lines.map(normalizeCriterion).filter(Boolean);
}

export async function handleCreateRun(
  repos: Repositories,
  req: Request,
): Promise<Response> {
  return withValidatedBody(
    req,
    CreateRunBodySchema,
    async (body) => {
      const projectId = body.projectId;
      const project = await getProject(projectId, true);
      if (!project) {
        return errorResponse(
          `Project "${projectId}" not found or inaccessible.`,
          404,
        );
      }

      // A run always branches off the project's default branch, so its own
      // branch can never be one the repository already starts from. (The
      // schema already refused names git would refuse, plus main and master.)
      const branch = body.branch?.trim() || undefined;
      if (branch) {
        const defaultBranches = [
          project.defaultBranch,
          ...project.repositories.map((r) => r.defaultBranch),
        ].filter((b): b is string => Boolean(b));
        if (isReservedRunBranch(branch, defaultBranches)) {
          return errorResponse(
            `Branch "${branch}" is the project's default branch; a run must use a different branch.`,
            400,
          );
        }
      }

      // A run needs working Builder and Reviewer models before it starts;
      // the reason names each role to fix in Settings › Models (#278).
      try {
        await assertRolesReady();
      } catch (err: unknown) {
        if (err instanceof ModelUnavailableError) {
          return errorResponse(err.message, 409);
        }
        throw err;
      }

      const ticketId = body.ticketId || "";
      const ticketTitle = body.ticketTitle || ticketId;
      const plan = body.plan || "";
      const acceptanceCriteria = parseAcceptanceCriteria(
        body.acceptanceCriteria,
      );
      const description = body.description;

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
    },
    "Invalid JSON in request body.",
  );
}

export function handleGetRuns(repos: Repositories): Response {
  return jsonResponse(runs.listRuns(repos));
}

export function handleGetRun(repos: Repositories, runId: string): Response {
  const run = runs.getRun(repos, runId);
  if (!run) return errorResponse("Run not found.", 404);
  if (run.status === "pr_created") {
    runs.requestPullRequestCheck(repos, run.id);
  }
  return jsonResponse(run);
}

export function handleRunEvents(
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
      // An opening comment, written before any event: a buffering proxy forwards the headers at once.
      controller.enqueue(encoder.encode(": connected\n\n"));

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

        // Keepalive every SSE_KEEPALIVE_MS (Phase 2, Section 38)
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
        }, SSE_KEEPALIVE_MS);
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

export async function handleChatMessage(
  repos: Repositories,
  req: Request,
  runId: string,
): Promise<Response> {
  return withValidatedBody(
    req,
    ChatRunBodySchema,
    async (body) => {
      const result = await runs.chatWithRun(repos, runId, body.message);
      return jsonResponse<ChatWithRunResponse>(result);
    },
    "Invalid JSON in request body.",
  );
}

export async function handleStopRun(
  repos: Repositories,
  runId: string,
): Promise<Response> {
  return jsonResponse<StopRunResponse>({
    ok: true,
    run: await runs.stopRun(repos, runId),
  });
}

export async function handleTransitions(
  repos: Repositories,
  req: Request,
  runId: string,
): Promise<Response> {
  return withValidatedBody(
    req,
    TransitionRunBodySchema,
    async (body) => {
      const run = await runs.handleTransition(
        repos,
        runId,
        body.action,
        body.payload,
      );
      return jsonResponse<TransitionRunResponse>({ ok: true, run });
    },
    "Invalid JSON in request body.",
  );
}

export async function handleCreatePR(
  repos: Repositories,
  runId: string,
): Promise<Response> {
  const result = await runs.createPR(repos, runId);
  return jsonResponse<PrRunResponse>(result);
}

export async function handleResumeRun(
  repos: Repositories,
  runId: string,
): Promise<Response> {
  const run = await runs.resumeRun(repos, runId);
  return jsonResponse<ResumeRunResponse>({ ok: true, run });
}

export async function handleAbandonRun(
  repos: Repositories,
  req: Request,
  runId: string,
): Promise<Response> {
  // The reason body is optional (#182): older clients POST with no body at all,
  // and a body that fails to parse simply abandons without a reason. A body that
  // does parse is validated (#163 follow-up): `reason` is a trimmed string of at
  // most 500 characters with no control characters, or the request is a 400.
  const parsed = await parseJsonBody(req);
  let reason: string | undefined;
  if (parsed && typeof parsed === "object") {
    const result = validateAgainstSchema(parsed, AbandonRunBodySchema);
    if (!result.ok) return result.response;
    reason = result.data.reason;
  }
  const run = await runs.abandonRun(repos, runId, reason);
  return jsonResponse<AbandonRunResponse>({ ok: true, run });
}
