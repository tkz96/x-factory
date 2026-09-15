import { z } from "zod/v4";
import type { RunEvent } from "../types.js";

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

export async function parseJsonBody(
  req: Request,
): Promise<Record<string, unknown> | null> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Higher-order controller helper: validates JSON body and invokes handler.
 */
export async function withJsonBody<T = Record<string, unknown>>(
  req: Request,
  action: (body: T) => Promise<Response>,
  invalidMsg = "Invalid JSON body.",
): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse(invalidMsg, 400);
  }
  return action(body as unknown as T);
}

/**
 * Higher-order controller helper: validates JSON body against a Zod schema and invokes handler.
 * Returns 400 with structured field-level errors on failure.
 */
export async function withValidatedBody<T>(
  req: Request,
  schema: z.ZodType<T>,
  action: (data: T) => Promise<Response>,
  invalidJsonMsg = "Invalid JSON in request body.",
): Promise<Response> {
  const body = await parseJsonBody(req);
  if (!body || typeof body !== "object") {
    return errorResponse(invalidJsonMsg, 400);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message =
      firstIssue &&
      firstIssue.message !== "Required" &&
      firstIssue.message !== "Invalid input"
        ? firstIssue.message
        : `Request validation failed:\n${z.prettifyError(parsed.error)}`;
    return jsonResponse(
      {
        error: message,
        details: parsed.error.issues,
      },
      400,
    );
  }
  return action(parsed.data);
}

/**
 * Higher-order controller helper: safely catches unhandled errors and maps to standard response.
 */
export async function catchHttpErrors(
  action: () => Promise<Response>,
  defaultStatus = 400,
): Promise<Response> {
  try {
    return await action();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg.includes("not found") ? 404 : defaultStatus;
    return errorResponse(msg, status);
  }
}

export function createEventStreamResponse(
  initialEvents: RunEvent[],
  subscribe: (listener: (event: RunEvent) => void) => () => void,
): Response {
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of initialEvents) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
      }

      unsubscribe = subscribe((event) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        } catch {
          // Client disconnected
        }
      });
    },
    cancel() {
      if (unsubscribe) unsubscribe();
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
