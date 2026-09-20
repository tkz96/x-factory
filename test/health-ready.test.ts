// test/health-ready.test.ts — Distinct liveness and readiness probe tests (XFM-69).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import {
  registerWorkerHeartbeat,
  resetWorkerRegistryForTesting,
} from "../src/diagnostics/worker-registry.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

describe("API Health & Readiness Probes (XFM-69)", () => {
  beforeEach(() => {
    resetWorkerRegistryForTesting();
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);
  });

  afterEach(() => {
    setDbForTesting(null);
    resetWorkerRegistryForTesting();
  });

  it("GET /api/health returns 200 OK regardless of worker state (liveness)", async () => {
    const req = new Request("http://localhost/api/health");
    const res = await handleApi(req, new URL(req.url));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-ID")).toBeDefined();

    const body = (await res.json()) as {
      status: string;
      uptime: number;
      version: string;
    };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBe("0.1.0");
  });

  it("GET /api/ready returns 503 when no background workers are active (readiness)", async () => {
    // Database is initialized, but no workers have reported heartbeats
    const req = new Request("http://localhost/api/ready");
    const res = await handleApi(req, new URL(req.url));

    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      database: { status: string; version: number };
      worker: { status: string; activeWorkers: number; reason?: string };
    };

    expect(body.status).toBe("unavailable");
    expect(body.database.status).toBe("ready");
    expect(body.database.version).toBe(6);
    expect(body.worker.status).toBe("unavailable");
    expect(body.worker.activeWorkers).toBe(0);
    expect(body.worker.reason).toContain("No active background worker");
  });

  it("GET /api/ready returns 200 when database and workers are healthy", async () => {
    // Register active worker heartbeat
    registerWorkerHeartbeat("worker-primary", { pid: 1234 });

    const req = new Request("http://localhost/api/ready");
    const res = await handleApi(req, new URL(req.url));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: string;
      database: { status: string; version: number; journalMode: string };
      worker: { status: string; activeWorkers: number };
    };

    expect(body.status).toBe("ready");
    expect(body.database.status).toBe("ready");
    expect(body.database.version).toBe(6);
    expect(body.worker.status).toBe("ready");
    expect(body.worker.activeWorkers).toBe(1);
  });

  it("GET /api/ready returns 503 when database is uninitialized", async () => {
    // Empty database without schema migrations
    const unmigratedDb = createDatabase({ path: ":memory:" });
    setDbForTesting(unmigratedDb);
    registerWorkerHeartbeat("worker-primary");

    const req = new Request("http://localhost/api/ready");
    const res = await handleApi(req, new URL(req.url));

    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      database: { status: string; version: number };
    };
    expect(body.status).toBe("unavailable");
    expect(body.database.version).toBe(0);
  });

  it("verifies health and readiness maintain distinct operational semantics", async () => {
    // Even when worker is down and ready probe fails with 503:
    const readyReq = new Request("http://localhost/api/ready");
    const readyRes = await handleApi(readyReq, new URL(readyReq.url));
    expect(readyRes.status).toBe(503);

    // Health probe must still return 200 so orchestrator doesn't kill the HTTP container
    const healthReq = new Request("http://localhost/api/health");
    const healthRes = await handleApi(healthReq, new URL(healthReq.url));
    expect(healthRes.status).toBe(200);
  });
});
