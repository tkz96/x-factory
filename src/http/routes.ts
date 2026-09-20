// src/http/routes.ts — Thin HTTP routing dispatcher delegating to specialized controllers.

import {
  emitStructuredLog,
  extractRequestId,
} from "../diagnostics/correlation.js";
import {
  handleDiagnosticsRoute,
  handleHealthRoute,
  handleReadyRoute,
} from "./diagnostics-controller.js";
import { getOpenApiSpec } from "./openapi.js";
import { handleProjectsRoute } from "./projects-controller.js";
import { errorResponse, jsonResponse } from "./responses.js";
import { handleRunsRoute } from "./runs-controller.js";
import { handleSettingsRoute } from "./settings-controller.js";

async function routeApiRequest(
  method: string,
  parts: string[],
  req: Request,
): Promise<Response | null> {
  const [resource, id, action, subaction] = parts;

  // Liveness probe (XFM-69)
  if (resource === "health") {
    return handleHealthRoute();
  }

  // Readiness probe (XFM-69)
  if (resource === "ready") {
    return handleReadyRoute();
  }

  // Operational diagnostics (XFM-70)
  if (resource === "diagnostics") {
    return handleDiagnosticsRoute();
  }

  if (resource === "openapi.json" || resource === "openapi") {
    return jsonResponse(getOpenApiSpec());
  }

  if (
    resource === "projects" ||
    resource === "discovery" ||
    resource === "inspection"
  ) {
    return handleProjectsRoute(
      method,
      id,
      action,
      subaction,
      parts.length,
      req,
    );
  }

  if (resource === "runs") {
    return handleRunsRoute(method, id, action, parts.length, req);
  }

  if (resource === "settings") {
    return handleSettingsRoute(method, req);
  }

  return null;
}

export async function handleApi(req: Request, url: URL): Promise<Response> {
  const method = req.method;
  const requestId = extractRequestId(req);
  const parts = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);

  try {
    const response =
      (await routeApiRequest(method, parts, req)) ||
      errorResponse("Endpoint not found.", 404);

    // Propagate standard correlation ID in HTTP headers (XFM-73)
    response.headers.set("X-Request-ID", requestId);
    return response;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emitStructuredLog(
      "error",
      `API Error [${method} ${url.pathname}]: ${message}`,
      { request_id: requestId },
    );
    const errRes = errorResponse(message, 500);
    errRes.headers.set("X-Request-ID", requestId);
    return errRes;
  }
}
