// src/server.ts — Native Bun HTTP server entry point and lifecycle management (XFM-71).

import type { Database } from "bun:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjects } from "./config.js";
import { createDatabase } from "./db/connection.js";
import { runMigrations } from "./db/migrator.js";
import { emitStructuredLog } from "./diagnostics/correlation.js";
import { defaultEventBus } from "./events.js";
import { reportStaleWorktrees } from "./git.js";
import { getOpenApiSpec } from "./http/openapi.js";
import { jsonResponse } from "./http/responses.js";
import { handleApi } from "./http/routes.js";
import { serveStatic } from "./http/static.js";
import * as runs from "./runs.js";

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
): ServerInstance {
  const publicDir = customPublicDir ?? getPublicDir();
  let db: Database;

  // Initialize SQLite and verify migrations
  try {
    db = customDb ?? createDatabase();
    runMigrations(db);
  } catch (err: unknown) {
    console.error("[X-Factory] Failed to initialize SQLite database:", err);
    throw err;
  }

  // Hydrate historical runs from disk
  runs.initRuns().catch(() => {});

  // Non-destructive startup check for orphaned worktrees
  checkOrphanedWorktrees();

  let shuttingDown = false;
  let inFlightRequests = 0;

  const bunServer = Bun.serve({
    port,
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
          return await handleApi(req, url);
        }
        if (url.pathname === "/openapi.json") {
          return jsonResponse(getOpenApiSpec());
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

    // 1. Send close notification to all active SSE streams (XFM-71)
    defaultEventBus.closeAll("Server is shutting down");

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
