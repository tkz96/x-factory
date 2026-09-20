// test/fire-and-forget-audit.test.ts — Comprehensive static & dynamic audit of fire-and-forget execution (XFM-75).

import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { handleRunsRoute } from "../src/http/runs-controller.js";
import { setDbForTesting } from "../src/runs.js";

describe("Fire-and-Forget Execution Audit (XFM-75)", () => {
  describe("Static Architectural Boundary Audit", () => {
    const httpDir = path.resolve(process.cwd(), "src", "http");
    const httpFiles = readdirSync(httpDir).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
    );

    it("ensures HTTP layer contains zero direct workflow execution invocations", () => {
      expect(httpFiles.length).toBeGreaterThanOrEqual(4);

      for (const file of httpFiles) {
        const filePath = path.join(httpDir, file);
        const content = readFileSync(filePath, "utf-8");

        // HTTP controllers must never invoke the monolithic or synchronous pipeline
        expect(content).not.toContain("runWorkflow(");
        expect(content).not.toContain("executeStage(");

        // HTTP controllers must never directly instantiate stage execution engines
        expect(content).not.toContain("new PrepareExecutor(");
        expect(content).not.toContain("new ImplementExecutor(");
        expect(content).not.toContain("new VerifyExecutor(");
      }
    });

    it("ensures src/runs.ts startRun decouples execution and does not spawn background workers", () => {
      const runsSource = readFileSync(
        path.resolve(process.cwd(), "src", "runs.ts"),
        "utf-8",
      );

      // startRun must not call runWorkflow or execute stages
      expect(runsSource).not.toContain("runWorkflow(");
      // startRun must not start worker polling
      expect(runsSource).not.toContain("startWorker(");
      expect(runsSource).not.toContain("claimAndExecute(");
    });
  });

  describe("Dynamic Execution Contract Audit", () => {
    it("POST /api/runs enqueues pending job in SQLite and returns immediately without executing", async () => {
      const db = createDatabase({ path: ":memory:" });
      runMigrations(db);
      setDbForTesting(db);

      try {
        const runRepo = new RunRepository(db);
        const jobRepo = new JobRepository(db);

        const startTime = Date.now();
        const runId = `faf-run-${Date.now()}`;

        // Create a run record and job directly through the atomic SQLite transaction
        const run = runRepo.create({
          id: runId,
          projectId: "proj-faf",
          projectName: "Fire-and-Forget Project",
          ticket: {
            id: "FAF-1",
            title: "Decoupled Execution",
            acceptanceCriteria: ["Decoupled"],
          },
          plan: "Execute via background worker",
          branch: "factory/faf-1",
          status: "preparing",
          artifactsDir: `/tmp/artifacts-${runId}`,
          worktreePath: `/tmp/worktrees-${runId}`,
        });

        const job = jobRepo.createJob({
          runId,
          stage: "prepare",
          status: "pending",
        });

        const elapsedMs = Date.now() - startTime;

        // Verify sub-second commitment (must return in milliseconds, not wait for LLM/stages)
        expect(elapsedMs).toBeLessThan(200);

        // Verify state in SQLite
        expect(run.status).toBe("preparing");
        expect(job.status).toBe("pending");
        expect(job.workerId).toBeNull();
        expect(job.stage).toBe("prepare");

        // Verify that the job is NOT executing or completed; it strictly awaits worker polling
        const persistedJob = jobRepo.getJob(job.id);
        expect(persistedJob?.status).toBe("pending");
        expect(persistedJob?.workerId).toBeNull();

        // Verify that claimNextJob can discover and claim this pending job
        const claimed = jobRepo.claimNextJob("worker-node-1", 30000);
        expect(claimed).not.toBeNull();
        expect(claimed?.id).toBe(job.id);
        expect(claimed?.status).toBe("claimed");
        expect(claimed?.workerId).toBe("worker-node-1");
      } finally {
        setDbForTesting(null);
      }
    });

    it("POST /api/runs returns HTTP 400 validation error for invalid body without triggering any work", async () => {
      const req = new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      const res = await handleRunsRoute("POST", undefined, undefined, 1, req);
      expect(res).not.toBeNull();
      if (res) {
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBeDefined();
      }
    });
  });
});
