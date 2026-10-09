// test/graceful-shutdown.test.ts — Coordinated application shutdown and lifecycle tests (XFM-71).

import { afterEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { defaultSSERegistry } from "../src/http/sse-registry.js";
import { type ServerInstance, startServer } from "../src/server.js";

describe("Coordinated Graceful Application Shutdown (XFM-71)", () => {
  let activeServer: ServerInstance | null = null;
  let activeDbPaths: string[] = [];

  const getTestDbPath = () => {
    const p = `/tmp/test-shutdown-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    activeDbPaths.push(p);
    return p;
  };

  afterEach(async () => {
    if (activeServer) {
      await activeServer.shutdown(1000).catch(() => {});
      activeServer = null;
    }
    for (const p of activeDbPaths) {
      try {
        const db = createDatabase({ path: p });
        db.close();
      } catch {
        // ignore
      }
    }
    activeDbPaths = [];
  });

  it("closes all active SSE streams on sseRegistry.closeAll during shutdown", async () => {
    let closed = false;

    const unregister = defaultSSERegistry.register(() => {
      closed = true;
    });

    expect(defaultSSERegistry.count).toBeGreaterThan(0);

    // Trigger closeAll
    defaultSSERegistry.closeAll();

    // Assert: stream close callback was invoked
    expect(closed).toBe(true);
    expect(defaultSSERegistry.count).toBe(0);

    unregister();
  });

  it("rejects new incoming non-health HTTP requests with HTTP 503 during shutdown", async () => {
    const db = createDatabase({ path: getTestDbPath() });
    runMigrations(db);

    activeServer = startServer(0, undefined, db);
    const port = activeServer.port;

    // Verify server accepts requests normally
    const normalRes = await fetch(`http://localhost:${port}/api/health`);
    expect(normalRes.status).toBe(200);

    // Initiate shutdown
    const shutdownPromise = activeServer.shutdown(2000);
    expect(activeServer.isShuttingDown()).toBe(true);
    expect(typeof activeServer.getInFlightCount()).toBe("number");

    // While shutting down, new requests for projects/runs return 503 Service Unavailable
    const blockedRes = await fetch(`http://localhost:${port}/api/runs`);
    expect(blockedRes.status).toBe(503);
    expect(blockedRes.headers.get("Retry-After")).toBe("5");
    const blockedBody = (await blockedRes.json()) as { error: string };
    expect(blockedBody.error).toContain("Server is shutting down");

    // Liveness probe continues responding during drain
    const healthRes = await fetch(`http://localhost:${port}/api/health`);
    expect(healthRes.status).toBe(200);

    const result = await shutdownPromise;
    expect(result.ok).toBe(true);
    expect(result.inFlightRemaining).toBe(0);
  });

  it("drains in-flight requests cleanly before closing database", async () => {
    const db = createDatabase({ path: getTestDbPath() });
    runMigrations(db);

    activeServer = startServer(0, undefined, db);
    const port = activeServer.port;

    // Simulate an in-flight slow request
    let slowRequestFinished = false;
    const slowRequestPromise = (async () => {
      const res = await fetch(`http://localhost:${port}/api/projects`);
      if (res.status === 200) {
        slowRequestFinished = true;
      }
      return res;
    })();

    // Allow request to register
    for (let i = 0; i < 20; i++) {
      if (activeServer.getInFlightCount() > 0 || slowRequestFinished) break;
      await new Promise((r) => setTimeout(r, 2));
    }

    // Initiate shutdown while request is in flight
    const shutdownResult = await activeServer.shutdown(3000);

    const res = await slowRequestPromise;
    expect(res.status).toBe(200);
    expect(slowRequestFinished).toBe(true);
    expect(shutdownResult.ok).toBe(true);
  });
});
