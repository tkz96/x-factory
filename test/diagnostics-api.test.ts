// test/diagnostics-api.test.ts — Runtime diagnostics and correlation tests (XFM-70, XFM-73).

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import {
  extractRequestId,
  formatStructuredLog,
} from "../src/diagnostics/correlation.js";
import {
  registerWorkerHeartbeat,
  resetWorkerRegistryForTesting,
} from "../src/diagnostics/worker-registry.js";
import { handleApi } from "../src/http/routes.js";
import { setDbForTesting } from "../src/runs.js";

describe("Runtime Diagnostics & Correlation API (XFM-70, XFM-73)", () => {
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

  it("GET /api/diagnostics returns complete database, job, and worker metrics (XFM-70)", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);

    // Create 1 active run and 1 completed run
    const run1 = runRepo.create({
      id: "run-diag-1",
      projectId: "p1",
      projectName: "Proj 1",
      ticket: { id: "T1", title: "Active Ticket", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/t1",
      status: "implementing",
      artifactsDir: "/tmp/a1",
      worktreePath: "/tmp/w1",
    });

    const run2 = runRepo.create({
      id: "run-diag-2",
      projectId: "p1",
      projectName: "Proj 1",
      ticket: { id: "T2", title: "Finished Ticket", acceptanceCriteria: [] },
      plan: "plan",
      branch: "factory/t2",
      status: "pr_created",
      artifactsDir: "/tmp/a2",
      worktreePath: "/tmp/w2",
    });

    // Create jobs in various states
    jobRepo.createJob({
      runId: run1.id,
      stage: "prepare",
      status: "completed",
    });
    jobRepo.createJob({
      runId: run1.id,
      stage: "implement",
      status: "pending",
    });
    jobRepo.claimNextJob("worker-alpha", 30000);

    // Create a stale claimed job
    const staleJob = jobRepo.createJob({
      runId: run2.id,
      stage: "deliver",
      status: "pending",
    });
    jobRepo.claimNextJob("worker-dead", 30000);
    // Artificially expire lease in DB
    db.run(
      "UPDATE jobs SET lease_until = '2020-01-01T00:00:00.000Z' WHERE id = ?",
      [staleJob.id],
    );

    // Register active worker
    registerWorkerHeartbeat("worker-alpha", { hostname: "node-1", pid: 999 });

    const req = new Request("http://localhost/api/diagnostics");
    const res = await handleApi(req, new URL(req.url));

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Request-ID")).toBeDefined();

    const body = (await res.json()) as {
      status: string;
      system: { uptime: number; nodeVersion: string };
      database: {
        status: string;
        version: number;
        runs: { total: number; active: number };
        jobs: {
          total: number;
          pending: number;
          claimed: number;
          completed: number;
          stale: number;
        };
      };
      worker: {
        status: string;
        activeCount: number;
        fleet: Array<{ workerId: string }>;
      };
    };

    expect(body.status).toBe("ok");
    expect(body.database.runs.total).toBe(2);
    expect(body.database.runs.active).toBe(1);
    expect(body.database.jobs.total).toBe(3);
    expect(body.database.jobs.stale).toBe(1);
    expect(body.worker.status).toBe("healthy");
    expect(body.worker.activeCount).toBe(1);
    expect(body.worker.fleet[0]?.workerId).toBe("worker-alpha");
  });

  it("propagates client X-Request-ID header or auto-generates if missing (XFM-73)", async () => {
    // 1. Client provides explicit request ID
    const customReqId = "req-client-custom-42";
    const req1 = new Request("http://localhost/api/health", {
      headers: { "X-Request-ID": customReqId },
    });
    const res1 = await handleApi(req1, new URL(req1.url));
    expect(res1.headers.get("X-Request-ID")).toBe(customReqId);

    // 2. Client provides no header -> auto-generated
    const req2 = new Request("http://localhost/api/health");
    const res2 = await handleApi(req2, new URL(req2.url));
    const generatedId = res2.headers.get("X-Request-ID");
    expect(generatedId).toBeDefined();
    expect(generatedId?.startsWith("req_")).toBe(true);

    expect(extractRequestId(req1)).toBe(customReqId);
    expect(extractRequestId(req2).startsWith("req_")).toBe(true);
  });

  it("formats structured log entries with cross-process correlation fields (XFM-73)", () => {
    const entry = formatStructuredLog(
      "info",
      "Stage transition recorded",
      {
        request_id: "req_123",
        run_id: "run-456",
        job_id: "job-789",
        stage: "implement",
        worker_id: "worker-1",
        attempt: 2,
      },
      { duration_ms: 120 },
    );

    expect(entry.timestamp).toBeDefined();
    expect(entry.level).toBe("info");
    expect(entry.message).toBe("Stage transition recorded");
    expect(entry.request_id).toBe("req_123");
    expect(entry.run_id).toBe("run-456");
    expect(entry.job_id).toBe("job-789");
    expect(entry.stage).toBe("implement");
    expect(entry.worker_id).toBe("worker-1");
    expect(entry.attempt).toBe(2);
    expect(entry.duration_ms).toBe(120);
  });
});
