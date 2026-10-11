// src/http/events-controller.ts — App-wide event stream and snapshot controller (#257, spec #241).

import type { Repositories } from "../composition-root.js";
import * as runs from "../runs.js";
import type { AppEventEnvelope, EventsSnapshot } from "../shared/types.js";
import { errorResponse, jsonResponse } from "./responses.js";
import { defaultSSERegistry } from "./sse-registry.js";

/** Formats an AppEventEnvelope into SSE wire format with id: matching global run_events ID. */
export function formatAppEventSSE(envelope: AppEventEnvelope): string {
  return `id: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/**
 * Parses and reconciles effective event cursor per the spec recovery contract (#241, #257):
 * - query cursor (last_event_id or cursor), else Last-Event-ID header;
 * - lower wins when both valid;
 * - invalid cursors (non-numeric, negative, floating) count as absent;
 * - no valid cursor → returns error telling client to snapshot.
 */
export function parseEffectiveCursor(
  req: Request,
  urlCandidate?: URL,
): { ok: true; cursor: number } | { ok: false; error: string } {
  let url: URL;
  try {
    url = urlCandidate ?? new URL(req.url);
  } catch {
    url = new URL("http://localhost");
  }

  const parseNonNegativeInteger = (
    raw: string | null | undefined,
  ): number | null => {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const num = parseInt(trimmed, 10);
    return Number.isSafeInteger(num) && num >= 0 ? num : null;
  };

  const queryVal =
    url.searchParams.get("last_event_id") ?? url.searchParams.get("cursor");
  const queryCursor = parseNonNegativeInteger(queryVal);

  const headerVal = req.headers.get("last-event-id");
  const headerCursor = parseNonNegativeInteger(headerVal);

  if (queryCursor !== null && headerCursor !== null) {
    return { ok: true, cursor: Math.min(queryCursor, headerCursor) };
  }
  if (queryCursor !== null) {
    return { ok: true, cursor: queryCursor };
  }
  if (headerCursor !== null) {
    return { ok: true, cursor: headerCursor };
  }

  return {
    ok: false,
    error:
      "A valid event cursor is required (via last_event_id query parameter or Last-Event-ID header). Please take a fresh snapshot.",
  };
}

/**
 * Handles GET /api/events/snapshot.
 * Reads current run statuses, Needs-you trigger events (no age limit), and Finished history
 * (7 days, max 100) with cursor in one SQLite read transaction (#257).
 */
export function handleGetEventsSnapshot(repos: Repositories): Response {
  const snapshot = runs.getEventsSnapshot(repos);
  return jsonResponse<EventsSnapshot>(snapshot);
}

/**
 * Handles GET /api/events.
 * Streams notification-relevant events across all runs over SSE with own envelope (#257).
 */
export function handleAppEvents(
  repos: Repositories,
  req: Request,
  url?: URL,
): Response {
  const cursorResult = parseEffectiveCursor(req, url);
  if (!cursorResult.ok) {
    return errorResponse(cursorResult.error, 400);
  }

  let lastSequence = cursorResult.cursor;
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
          const events = runs.getAppEvents(repos, lastSequence);
          for (const event of events) {
            controller.enqueue(encoder.encode(formatAppEventSSE(event)));
            lastSequence = event.id;
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

      // Initial catch-up replay of events above the cursor
      pollEvents();

      if (!isClosed) {
        // Poll SQLite every 300ms
        pollTimer = setInterval(pollEvents, 300);

        // Keepalive every 15s
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
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
