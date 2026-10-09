import { z } from "zod/v4";
import {
  ConflictError,
  GitConfigError,
  NotFoundError,
  SemanticValidationError,
  ValidationError,
} from "../errors.js";

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

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string | undefined,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Family membership for the name → status ladder, consulted once.
 *
 * An error belongs to a family by prototype chain — `RunNotFoundError`,
 * `StaleRevisionError` and `IllegalStateTransitionError` carry their own
 * names but are still NotFound/Conflict family members — or, for an error
 * that crossed a realm boundary (worker, VM, another module registry) by
 * exact family name: it carries the right name but would fail `instanceof`.
 * Anything that is not an `Error` belongs to no family.
 */
function inErrorFamily(
  err: unknown,
  family: abstract new (...args: never[]) => Error,
  familyName: string,
): boolean {
  if (err instanceof family) return true;
  return err instanceof Error && err.name === familyName;
}

/**
 * The stable machine-readable code a domain error carries, or `fallback`.
 * The single server-side home of the "has a string `code`" duck-type read;
 * family members are read defensively because an error that matched by name
 * alone may carry neither the class nor the fields.
 */
function errorCodeOf(err: unknown, fallback?: string): string | undefined {
  if (
    err &&
    typeof err === "object" &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  ) {
    return (err as { code: string }).code;
  }
  return fallback;
}

/**
 * The 409 envelope for a semantic validation error: codes only, never messages.
 *
 * The members are read defensively because matching is by family name as well
 * as by prototype chain: a duck-typed error may carry neither, and a
 * translator that throws would turn an intended 409 into an unhandled failure.
 */
function semanticErrorEnvelope(err: unknown): Record<string, unknown> {
  const source = err as {
    fieldErrors?: unknown;
    formErrors?: unknown;
  };
  const fieldErrors =
    source.fieldErrors && typeof source.fieldErrors === "object"
      ? (source.fieldErrors as Record<string, string>)
      : {};
  const formErrors = Array.isArray(source.formErrors)
    ? (source.formErrors as string[])
    : [];

  const body: Record<string, unknown> = {};
  if (Object.keys(fieldErrors).length > 0) {
    body.fieldErrors = fieldErrors;
  }
  if (formErrors.length > 0) {
    body.formErrors = formErrors;
  }
  return body;
}

/**
 * Translates domain/application errors into presentation-layer HTTP responses.
 *
 * One family → status ladder, consulted once: family membership is decided by
 * `inErrorFamily` (prototype chain or exact name), and the fallback idiom for
 * a non-`instanceof`-able error exists in exactly one place.
 */
export function translateDomainErrorToHttpResponse(
  err: unknown,
): Response | null {
  const message = err instanceof Error ? err.message : "";

  if (inErrorFamily(err, NotFoundError, "NotFoundError")) {
    return errorResponse(message, 404);
  }
  if (inErrorFamily(err, ValidationError, "ValidationError")) {
    const code = errorCodeOf(err);
    return jsonResponse(
      code ? { error: message, code } : { error: message },
      400,
    );
  }
  if (inErrorFamily(err, ConflictError, "ConflictError")) {
    return errorResponse(message, 409);
  }
  if (inErrorFamily(err, SemanticValidationError, "SemanticValidationError")) {
    return jsonResponse(semanticErrorEnvelope(err), 409);
  }
  if (inErrorFamily(err, GitConfigError, "GitConfigError")) {
    const code = errorCodeOf(err, "GIT_CONFIG_WRITE_FAILED");
    const status =
      err &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : 500;
    return jsonResponse({ error: message, code }, status);
  }
  if (err instanceof HttpError) {
    return jsonResponse(
      err.code
        ? { error: err.message, code: err.code }
        : { error: err.message },
      err.status,
    );
  }
  return null;
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

export type SchemaValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

/**
 * Validates an already-parsed body against a schema, returning the standard
 * structured 400 response on failure. Shared by `withValidatedBody` and by
 * controllers that must choose their schema after reading the body.
 */
export function validateAgainstSchema<T>(
  body: unknown,
  schema: z.ZodType<T>,
): SchemaValidationResult<T> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const message =
      firstIssue &&
      firstIssue.message !== "Required" &&
      firstIssue.message !== "Invalid input"
        ? firstIssue.message
        : `Request validation failed:\n${z.prettifyError(parsed.error)}`;
    return {
      ok: false,
      response: jsonResponse(
        { error: message, details: parsed.error.issues },
        400,
      ),
    };
  }
  return { ok: true, data: parsed.data };
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
  const result = validateAgainstSchema(body, schema);
  if (!result.ok) return result.response;
  return action(result.data);
}

/**
 * Higher-order controller helper: safely catches unhandled errors and maps to standard response.
 */
export async function catchHttpErrors(
  action: () => Promise<Response>,
): Promise<Response> {
  try {
    return await action();
  } catch (err: unknown) {
    const mapped = translateDomainErrorToHttpResponse(err);
    if (mapped) {
      return mapped;
    }
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(msg, 500);
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
