// src/server.ts — Native Bun HTTP server entry point and lifecycle management.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjects } from "./config.js";
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

export function startServer(port = PORT, customPublicDir?: string) {
  const publicDir = customPublicDir ?? getPublicDir();

  // Hydrate historical runs from disk
  runs.initRuns().catch(() => {});

  // Non-destructive startup check for orphaned worktrees
  checkOrphanedWorktrees();

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname.startsWith("/api/")) {
        return handleApi(req, url);
      }
      if (url.pathname === "/openapi.json") {
        return jsonResponse(getOpenApiSpec());
      }
      return serveStatic(url.pathname, publicDir);
    },
  });

  console.log(`X-Factory running at http://localhost:${server.port}`);
  return server;
}

// Only start automatically if executed directly
if (import.meta.main) {
  startServer();
}
