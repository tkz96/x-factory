// src/http/routes.ts — Thin HTTP routing dispatcher delegating to specialized controllers.

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
  if (resource === "health") {
    return jsonResponse({
      status: "ok",
      uptime: Math.floor(process.uptime()),
      version: "0.1.0",
    });
  }
  if (
    resource === "projects" ||
    resource === "discovery" ||
    resource === "inspection"
  )
    return handleProjectsRoute(
      method,
      id,
      action,
      subaction,
      parts.length,
      req,
    );
  if (resource === "runs")
    return handleRunsRoute(method, id, action, parts.length, req);
  if (resource === "settings") return handleSettingsRoute(method, req);
  return null;
}

export async function handleApi(req: Request, url: URL): Promise<Response> {
  const method = req.method;
  const parts = url.pathname
    .replace(/^\/api\/?/, "")
    .split("/")
    .filter(Boolean);

  try {
    const response = await routeApiRequest(method, parts, req);
    return response || errorResponse("Endpoint not found.", 404);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`API Error [${method} ${url.pathname}]:`, message);
    return errorResponse(message, 500);
  }
}
