// test/api-restart.test.ts — API process restart resilience while worker continues executing (XFM-58).

import { afterAll, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import type {
  StageContext,
  StageExecutor,
  StageResult,
} from "../src/executors/index.js";
import { getOpenApiSpec } from "../src/http/openapi.js";
import { jsonResponse } from "../src/http/responses.js";
import { handleApi } from "../src/http/routes.js";
import { serveStatic } from "../src/http/static.js";
import { setDbForTesting } from "../src/runs.js";
import { getPublicDir } from "../src/server.js";
import { Worker } from "../src/worker.js";

describe("API Process Restart Resilience (XFM-58)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  function startTestServer(port = 0) {
    const publicDir = getPublicDir();
    return Bun.serve({
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
  }

  it("worker executes uninterrupted across API server shutdown and restart", async () => {
    // Shared SQLite database between API server and Worker
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const eventRepo = new EventRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);

    // 1. Create a run and two sequential jobs
    const runId = `run-api-restart-${Date.now()}`;
    const run = runRepo.create({
      id: runId,
      projectId: "proj-restart",
      projectName: "Restart Test Project",
      ticket: {
        id: "RES-1",
        title: "API Restart Ticket",
        acceptanceCriteria: ["Resilient execution"],
      },
      plan: "Step 1\nStep 2",
      branch: "factory/RES-1",
      status: "preparing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
      status: "pending",
    });

    eventRepo.appendEvent(run.id, "status", {
      status: "preparing",
      text: "Run created",
    });

    // 2. Start API Server Instance #1
    const server1 = startTestServer(0);
    const baseUrl1 = `http://localhost:${server1.port}`;

    // Query API Server 1
    const res1 = await fetch(`${baseUrl1}/api/runs/${runId}`);
    expect(res1.status).toBe(200);
    const runData1 = (await res1.json()) as { status: string; id: string };
    expect(runData1.id).toBe(runId);
    expect(runData1.status).toBe("preparing");

    // 3. Start the worker with a mock executor that pauses slightly
    let prepareExecuted = false;
    let understandExecuted = false;

    const mockExecutor: StageExecutor = {
      stage: "prepare",
      async execute(ctx: StageContext): Promise<StageResult> {
        if (ctx.job.stage === "prepare") {
          prepareExecuted = true;
          // emit an event into event repo
          ctx.eventRepo.appendEvent(ctx.run.id, "info", {
            text: "Prepared during API restart window",
          });
          return {
            status: "success",
            nextStage: "understand",
            nextRunStatus: "understanding",
            output: { step: 1 },
          };
        }
        if (ctx.job.stage === "understand") {
          understandExecuted = true;
          ctx.eventRepo.appendEvent(ctx.run.id, "info", {
            text: "Understood while API was restarted",
          });
          return {
            status: "success",
            nextRunStatus: "implementing",
            output: { step: 2 },
          };
        }
        return { status: "success" };
      },
    };

    const worker = new Worker({
      workerId: "test-restart-resilient-worker",
      db,
      pollIntervalMs: 50,
      getStageExecutor: () => mockExecutor,
    });

    // Start worker in background
    await worker.start();

    // Wait until stage 1 finishes
    while (!prepareExecuted) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // 4. Shut down API Server 1 while worker continues processing
    server1.stop(true);

    // Verify API Server 1 is dead (fetch throws connection refused)
    let server1Dead = false;
    try {
      await fetch(`${baseUrl1}/api/runs/${runId}`);
    } catch {
      server1Dead = true;
    }
    expect(server1Dead).toBe(true);

    // Wait until worker processes the queued 'understand' stage while server is dead
    while (!understandExecuted) {
      await new Promise((r) => setTimeout(r, 20));
    }

    // Stop worker
    await worker.stop();

    // 5. Start API Server Instance #2
    const server2 = startTestServer(0);
    const baseUrl2 = `http://localhost:${server2.port}`;

    try {
      // 6. Query API Server 2 for the run
      const res2 = await fetch(`${baseUrl2}/api/runs/${runId}`);
      expect(res2.status).toBe(200);
      const runData2 = (await res2.json()) as {
        id: string;
        status: string;
      };
      expect(runData2.id).toBe(runId);
      expect(runData2.status).toBe("implementing");

      // Verify attempts were recorded in SQLite
      const attempts = stageAttemptRepo.listForRun(runId);
      expect(attempts.length).toBe(2);
      expect(attempts.map((a) => a.stage)).toEqual(["prepare", "understand"]);
      expect(attempts.every((a) => a.status === "completed")).toBe(true);

      // 7. Verify SSE event streaming with Last-Event-ID resumes seamlessly
      const sseRes = await fetch(`${baseUrl2}/api/runs/${runId}/events`, {
        headers: { "Last-Event-ID": "1" },
      });
      expect(sseRes.status).toBe(200);
      expect(sseRes.headers.get("Content-Type")).toContain("text/event-stream");

      const sseReader = sseRes.body?.getReader();
      expect(sseReader).toBeDefined();
      if (sseReader) {
        const chunk = await sseReader.read();
        const text = new TextDecoder().decode(chunk.value);
        expect(text).toContain("id: ");
        expect(text).toContain("Prepared during API restart window");
        await sseReader.cancel();
      }
    } finally {
      server2.stop(true);
    }
  });
});
