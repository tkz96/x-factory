import { z } from "zod/v4";

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

export interface WireSSEEvent {
  id: number;
  type: string;
  payload: unknown;
  timestamp: string;
}

export function formatSSEMessage(
  event: WireSSEEvent | Record<string, unknown>,
): string {
  const obj = event as Record<string, unknown>;
  const id =
    "sequence" in obj && typeof obj.sequence === "number"
      ? obj.sequence
      : "id" in obj && typeof obj.id === "number"
        ? obj.id
        : undefined;

  const timestamp =
    "timestamp" in obj && typeof obj.timestamp === "string"
      ? obj.timestamp
      : "createdAt" in obj && typeof obj.createdAt === "string"
        ? obj.createdAt
        : new Date().toISOString();

  const canonicalEvent: WireSSEEvent = {
    id: id ?? 0,
    type: String(obj.type || ""),
    payload: obj.payload ?? {},
    timestamp,
  };

  let out = "";
  if (id !== undefined && id !== null) {
    out += `id: ${id}\n`;
  }
  out += `data: ${JSON.stringify(canonicalEvent)}\n\n`;
  return out;
}
