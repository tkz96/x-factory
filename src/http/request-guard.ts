// src/http/request-guard.ts — Local-only API boundary: listen host, Origin and Content-Type checks.

import { errorResponse } from "./responses.js";

const DEFAULT_LISTEN_HOST = "127.0.0.1";
const DEFAULT_API_PORT = "3777";
const VITE_DEV_PORT = "5173";
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Host the API listens on. Loopback unless X_FACTORY_HOST overrides it. */
export function resolveListenHost(): string {
  const override = process.env.X_FACTORY_HOST?.trim();
  return override ? override : DEFAULT_LISTEN_HOST;
}

function apiPort(): string {
  return String(parseInt(process.env.PORT || DEFAULT_API_PORT, 10));
}

/** The API's own origin (loopback, API port) or the Vite dev UI origin. */
function isAllowedOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:") return false;
  if (!LOOPBACK_HOSTNAMES.has(parsed.hostname)) return false;
  return parsed.port === apiPort() || parsed.port === VITE_DEV_PORT;
}

function isJsonMediaType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Rejects cross-origin state-changing requests (403) and bodies that are not
 * declared as JSON (415). Returns null when the request may proceed.
 */
export function guardApiRequest(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (
    origin !== null &&
    STATE_CHANGING_METHODS.has(req.method) &&
    !isAllowedOrigin(origin)
  ) {
    return errorResponse("Cross-origin request rejected.", 403);
  }
  if (req.body !== null && !isJsonMediaType(req.headers.get("content-type"))) {
    return errorResponse("Request body must be application/json.", 415);
  }
  return null;
}
