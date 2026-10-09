// src/http/request-guard.ts — Local-only API boundary: listen host, Host, Origin and Content-Type checks.

import { errorResponse } from "./responses.js";

const DEFAULT_LISTEN_HOST = "127.0.0.1";
export const DEFAULT_API_PORT = 3777;
const VITE_DEV_PORT = 5173;
const LOOPBACK_HOSTNAMES = ["localhost", "127.0.0.1"];
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface ApiGuardConfig {
  /** Port the API is actually listening on. */
  port: number;
  /** Host the API listens on (resolveListenHost()). */
  listenHost: string;
}

export const DEFAULT_API_GUARD: ApiGuardConfig = {
  port: DEFAULT_API_PORT,
  listenHost: DEFAULT_LISTEN_HOST,
};

/** Host the API listens on. Loopback unless X_FACTORY_HOST overrides it. */
export function resolveListenHost(): string {
  const override = process.env.X_FACTORY_HOST?.trim();
  return override ? override : DEFAULT_LISTEN_HOST;
}

function isLoopbackListen(listenHost: string): boolean {
  return LOOPBACK_HOSTNAMES.includes(listenHost);
}

/** `host:port` as it appears in a Host header; IPv6 literals are bracketed. */
function authority(host: string, port: number): string {
  const bare = host.replace(/^\[(.*)\]$/, "$1");
  return bare.includes(":") ? `[${bare}]:${port}` : `${bare}:${port}`;
}

/** Host header values the API accepts (DNS rebinding defence). */
function allowedHosts(config: ApiGuardConfig): Set<string> {
  const hosts = new Set<string>();
  for (const name of LOOPBACK_HOSTNAMES) {
    hosts.add(authority(name, config.port));
  }
  if (!isLoopbackListen(config.listenHost)) {
    hosts.add(authority(config.listenHost, config.port).toLowerCase());
  }
  return hosts;
}

/** Origins the API accepts: its own origin, the Vite dev UI, and the configured host. */
function allowedOrigins(config: ApiGuardConfig): Set<string> {
  const origins = new Set<string>();
  for (const name of LOOPBACK_HOSTNAMES) {
    origins.add(`http://${name}:${config.port}`);
    origins.add(`http://${name}:${VITE_DEV_PORT}`);
  }
  if (!isLoopbackListen(config.listenHost)) {
    origins.add(
      `http://${authority(config.listenHost, config.port)}`.toLowerCase(),
    );
  }
  return origins;
}

function isJsonMediaType(contentType: string | null): boolean {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return mediaType === "application/json";
}

/**
 * Rejects requests whose Host is not the API's own (403), cross-origin
 * state-changing requests (403), and state-changing bodies that are not
 * declared as JSON (415). Returns null when the request may proceed.
 */
export function guardApiRequest(
  req: Request,
  config: ApiGuardConfig = DEFAULT_API_GUARD,
): Response | null {
  const host = (req.headers.get("host") ?? new URL(req.url).host).toLowerCase();
  if (!allowedHosts(config).has(host)) {
    return errorResponse("Host not allowed.", 403);
  }

  if (!STATE_CHANGING_METHODS.has(req.method)) {
    return null;
  }

  const origin = req.headers.get("origin");
  if (origin !== null && !allowedOrigins(config).has(origin.toLowerCase())) {
    return errorResponse("Cross-origin request rejected.", 403);
  }

  if (req.body !== null && !isJsonMediaType(req.headers.get("content-type"))) {
    return errorResponse("Request body must be application/json.", 415);
  }
  return null;
}
