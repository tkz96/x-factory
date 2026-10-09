// src/http/routes.ts — Thin HTTP routing dispatcher delegating to specialized controllers.

import {
  emitStructuredLog,
  extractRequestId,
} from "../diagnostics/correlation.js";
import type { ProviderRegistry } from "../providers/registry.js";
import {
  handleDiagnosticsRoute,
  handleHealthRoute,
  handleReadinessRoute,
  handleReadyRoute,
} from "./diagnostics-controller.js";
import { handleDocsRoute } from "./docs-controller.js";
import { getOpenApiSpec } from "./openapi.js";
import { handleProjectsRoute } from "./projects-controller.js";
import { handleProvidersRoute } from "./providers-controller.js";
import {
  type ApiGuardConfig,
  DEFAULT_API_GUARD,
  guardApiRequest,
} from "./request-guard.js";
import { errorResponse, jsonResponse } from "./responses.js";
import { handleRunsRoute } from "./runs-controller.js";
import { handleSettingsRoute } from "./settings-controller.js";

async function routeApiRequest(
  method: string,
  parts: string[],
  req: Request,
  customRegistry?: ProviderRegistry,
): Promise<Response | null> {
  const [resource, id, action, subaction] = parts;

  // In-app Diátaxis documentation (XFM-53)
  if (resource === "docs") {
    return handleDocsRoute(method, id, action, req);
  }

  // Liveness probe (XFM-69)
  if (resource === "health") {
    return handleHealthRoute();
  }

  // Readiness probe (XFM-69)
  if (resource === "ready") {
    return handleReadyRoute();
  }

  // UI Readiness check (XFM-48)
  if (resource === "readiness") {
    return handleReadinessRoute();
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
      customRegistry,
    );
  }

  if (resource === "runs") {
    return handleRunsRoute(method, id, action, parts.length, req);
  }

  if (resource === "settings") {
    return handleSettingsRoute(method, req);
  }

  if (resource === "providers") {
    const url = new URL(req.url);
    return handleProvidersRoute(
      method,
      parts.slice(1),
      req,
      url,
      customRegistry,
    );
  }

  return null;
}

export async function handleApi(
  req: Request,
  url: URL,
  customRegistry?: ProviderRegistry,
  guardConfig: ApiGuardConfig = DEFAULT_API_GUARD,
): Promise<Response> {
  const method = req.method;
  const requestId = extractRequestId(req);
  const parts = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);

  const rejected = guardApiRequest(req, guardConfig);
  if (rejected) {
    rejected.headers.set("X-Request-ID", requestId);
    return rejected;
  }

  try {
    const response =
      (await routeApiRequest(method, parts, req, customRegistry)) ||
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
