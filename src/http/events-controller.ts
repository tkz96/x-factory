// src/http/events-controller.ts — App-wide event stream and snapshot controller (#257, spec #241).

import type { Repositories } from "../composition-root.js";
import * as runs from "../runs.js";
import type { AppEventEnvelope, EventsSnapshot } from "../shared/types.js";
import { APP_EVENTS_KEEPALIVE_MS, appEventHubFor } from "./app-event-hub.js";
import { errorResponse, jsonResponse } from "./responses.js";
import { defaultSSERegistry } from "./sse-registry.js";

/** Formats an AppEventEnvelope into SSE wire format with id: matching global run_events ID. */
export function formatAppEventSSE(envelope: AppEventEnvelope): string {
  return `id: ${envelope.id}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/**
 * Parses and reconciles effective event cursor per the spec recovery contract (#241, #257):
 * - query cursor (last_event_id), else Last-Event-ID header;
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

  const queryCursor = parseNonNegativeInteger(
    url.searchParams.get("last_event_id"),
  );

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

  const hub = appEventHubFor(repos);
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  let isClosed = false;
  let unsubscribe: (() => void) | null = null;
  let unregisterRegistry: (() => void) | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  /** Stops timers and subscriptions once; optionally closes the stream. */
  const shutdown = (closeStream: boolean) => {
    if (isClosed) return;
    isClosed = true;
    if (keepaliveTimer) clearInterval(keepaliveTimer);
    keepaliveTimer = null;
    unsubscribe?.();
    unsubscribe = null;
    unregisterRegistry?.();
    unregisterRegistry = null;
    if (!closeStream) return;
    try {
      controllerRef?.close();
    } catch {
      // already closed by the client
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      const encoder = new TextEncoder();
      const send = (text: string) => controller.enqueue(encoder.encode(text));

      unregisterRegistry = defaultSSERegistry.register(() => shutdown(true));

      // Replays every event above the cursor in pages, then joins the shared poll.
      const unsub = hub.subscribe(cursorResult.cursor, {
        onEvents: (events) => {
          for (const event of events) send(formatAppEventSSE(event));
        },
        onError: (error) => {
          console.error("[X-Factory] App event stream closed on error", error);
          shutdown(true);
        },
      });
      if (isClosed) {
        unsub();
        return;
      }
      unsubscribe = unsub;

      keepaliveTimer = setInterval(() => {
        try {
          send(": keep-alive\n\n");
        } catch (error) {
          console.error("[X-Factory] App event keep-alive failed", error);
          shutdown(true);
        }
      }, APP_EVENTS_KEEPALIVE_MS);
    },
    cancel() {
      shutdown(false);
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
