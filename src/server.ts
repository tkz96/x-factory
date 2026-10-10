// src/server.ts — Native Bun HTTP server entry point and lifecycle management (XFM-71).

import { bootstrapLLMEnv } from "./env-bootstrap.js";

bootstrapLLMEnv();

import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Server } from "bun";
import {
  type ApiContext,
  createRepositories,
  openProcessDatabase,
} from "./composition-root.js";
import { loadProjects } from "./config.js";
import { runMigrations } from "./db/migrator.js";
import { emitStructuredLog } from "./diagnostics/correlation.js";
import { reportStaleWorktrees } from "./git.js";
import { resolveListenHost } from "./http/request-guard.js";
import { jsonResponse } from "./http/responses.js";
import { getOpenApiSpec } from "./http/route-table.js";
import { handleApi } from "./http/routes.js";
import { defaultSSERegistry } from "./http/sse-registry.js";
import { serveStatic } from "./http/static.js";
import type { ProviderRegistry } from "./providers/registry.js";
import type { ProjectWriteStore } from "./services/connection-write-plan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export function getPublicDir(): string {
  return process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "..", "dist", "public")
    : path.resolve(__dirname, "..", "public");
}
const PORT = parseInt(process.env.PORT || "3777", 10);

export function formatOrphanedWorktree(stalePath: string): string {
  return `  - ${stalePath}`;
}

export async function checkOrphanedWorktrees(): Promise<void> {
  try {
    const projects = await loadProjects();
    for (const p of projects) {
      const stale = await reportStaleWorktrees(p.id);
      if (stale.length > 0) {
        console.warn(
          `[X-Factory] Found ${stale.length} orphaned worktree(s) for project "${p.id}". Stored externally, not deleted:\n${stale.map(formatOrphanedWorktree).join("\n")}`,
        );
      }
    }
  } catch {
    // Non-fatal if config is empty on first boot
  }
}

export interface ServerInstance {
  port: number;
  stop: (closeActiveConnections?: boolean) => void;
  shutdown: (
    timeoutMs?: number,
  ) => Promise<{ ok: boolean; inFlightRemaining: number }>;
  isShuttingDown: () => boolean;
  getInFlightCount: () => number;
}

export function startServer(
  port = PORT,
  customPublicDir?: string,
  customDb?: Database,
  customProviderRegistry?: ProviderRegistry,
  customProjectWriteStore?: ProjectWriteStore,
): ServerInstance {
  const publicDir = customPublicDir ?? getPublicDir();
  let db: Database;

  // Composition root (#169): this process opens one connection, migrates it
  // once, and hands the same repository bundle to every request.
  try {
    if (customDb) {
      runMigrations(customDb);
      db = customDb;
    } else {
      db = openProcessDatabase();
    }
  } catch (err: unknown) {
    console.error("[X-Factory] Failed to initialize SQLite database:", err);
    throw err;
  }
  const apiContext: ApiContext = {
    repos: createRepositories(db),
    providerRegistry: customProviderRegistry,
    projectWriteStore: customProjectWriteStore,
  };

  // Non-destructive startup check for orphaned worktrees
  checkOrphanedWorktrees();

  let shuttingDown = false;
  let inFlightRequests = 0;

  const listenHost = resolveListenHost();
  const bunServer: Server<unknown> = Bun.serve({
    port,
    hostname: listenHost,
    async fetch(req) {
      const url = new URL(req.url);

      // Rejection of new requests during coordinated shutdown (XFM-71)
      if (shuttingDown && url.pathname !== "/api/health") {
        return new Response(
          JSON.stringify({
            error: "Server is shutting down. Please retry shortly.",
          }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "5",
            },
          },
        );
      }

      inFlightRequests++;
      try {
        if (url.pathname.startsWith("/api/")) {
          return await handleApi(req, url, {
            ...apiContext,
            guard: { port: bunServer.port ?? port, listenHost },
          });
        }
        if (url.pathname === "/openapi.json") {
          return jsonResponse(getOpenApiSpec());
        }
        if (
          process.env.NODE_ENV !== "production" &&
          !existsSync(path.join(publicDir, "index.html"))
        ) {
          const relPath = url.pathname === "/" ? "" : url.pathname.slice(1);
          const staticCandidate = path.normalize(path.join(publicDir, relPath));
          const isReferenceRoute = ["reference", "scalar", "api-docs"].includes(
            relPath.replace(/\/$/, ""),
          );
          const hasStaticFile =
            existsSync(staticCandidate) ||
            existsSync(`${staticCandidate}.html`) ||
            isReferenceRoute;
          if (!relPath || !hasStaticFile) {
            const ext = path.extname(url.pathname);
            if (!ext || ext === ".html") {
              return new Response(
                `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=http://localhost:5173${url.pathname}"><title>Redirecting…</title></head><body><p>Redirecting to <a href="http://localhost:5173${url.pathname}">Vite Dev Server</a>…</p></body></html>`,
                {
                  status: 302,
                  headers: {
                    Location: `http://localhost:5173${url.pathname}`,
                    "Content-Type": "text/html; charset=utf-8",
                  },
                },
              );
            }
          }
        }
        return await serveStatic(url.pathname, publicDir);
      } finally {
        inFlightRequests--;
      }
    },
  });

  const shutdown = async (
    timeoutMs = 5000,
  ): Promise<{ ok: boolean; inFlightRemaining: number }> => {
    if (shuttingDown) {
      return { ok: true, inFlightRemaining: inFlightRequests };
    }
    shuttingDown = true;
    emitStructuredLog("info", "Initiating coordinated graceful shutdown", {});

    // 1. Close all active SSE connections (Phase 2, Section 40)
    defaultSSERegistry.closeAll();

    // 2. Wait for in-flight requests to complete up to timeoutMs
    const deadline = Date.now() + timeoutMs;
    await new Promise((resolve) => setTimeout(resolve, 80));
    while (inFlightRequests > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // 3. Stop accepting new connections on the HTTP socket
    bunServer.stop(false);

    // 4. Close database connection cleanly to prevent WAL corruption
    try {
      db.close();
    } catch {
      // Ignore if already closed
    }

    emitStructuredLog(
      "info",
      "Server shutdown complete",
      {},
      { in_flight_remaining: inFlightRequests },
    );
    return { ok: true, inFlightRemaining: inFlightRequests };
  };

  // Signal handlers for independent execution
  const onSignal = () => {
    void shutdown().then(() => {
      process.exit(0);
    });
  };

  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  }

  console.log(`X-Factory running at http://localhost:${bunServer.port}`);

  return {
    port: bunServer.port ?? 0,
    stop: (closeActive?: boolean) => bunServer.stop(closeActive),
    shutdown,
    isShuttingDown: () => shuttingDown,
    getInFlightCount: () => inFlightRequests,
  };
}

// Only start automatically if executed directly
if (import.meta.main) {
  startServer();
}
