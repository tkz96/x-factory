// test/worker-lifecycle.test.ts — Unit tests for independent Worker polling and job lifecycle.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { Worker, type WorkerLogEntry } from "../src/worker.js";

describe("Worker Lifecycle", () => {
  function setup() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);

    const run = runRepo.create({
      id: "run-w-1",
      projectId: "proj-1",
      projectName: "Project One",
      ticket: {
        id: "T-W1",
        title: "Worker Test Ticket",
        acceptanceCriteria: ["Works"],
      },
      plan: "Worker Plan",
      branch: "factory/T-W1",
      status: "preparing",
      artifactsDir: "/tmp/artifacts-w1",
      worktreePath: "/tmp/worktrees-w1",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
    });

    return { db, runRepo, jobRepo, run, job };
  }

  it("initializes with unique workerId and connects to database", () => {
    const { db } = setup();
    const worker = new Worker({ db, workerId: "test-worker-01" });
    expect(worker.workerId).toBe("test-worker-01");
  });

  it("processes a claimed job and marks it completed", async () => {
    const { db, jobRepo, job } = setup();
    const mockExecutor = {
      stage: "prepare",
      async execute() {
        return {
          status: "success" as const,
          output: { prepared: true },
        };
      },
    };
    const worker = new Worker({
      db,
      workerId: "test-worker-02",
      getStageExecutor: () => mockExecutor,
    });

    // Claim the job
    const claimed = jobRepo.claimNextJob("test-worker-02", 30000);
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("Job claim failed unexpectedly.");
    expect(claimed.id).toBe(job.id);

    // Process job through worker logic
    await worker.processJob(claimed);

    const updated = jobRepo.getJob(job.id);
    expect(updated?.status).toBe("completed");
  });

  it("handles graceful shutdown cleanly", async () => {
    const { db } = setup();
    const worker = new Worker({ db, workerId: "test-worker-03" });

    await worker.start();
    await worker.stop();
    // Worker stopped without hanging or throwing
    expect(true).toBe(true);
  });

  it("emits structured logging with worker_id, job_id, duration_ms, and result (XFM-27)", async () => {
    const { db, jobRepo, job } = setup();
    const logEvents: WorkerLogEntry[] = [];
    const mockExecutor = {
      stage: "prepare",
      async execute() {
        return {
          status: "success" as const,
          output: { prepared: true },
        };
      },
    };
    const worker = new Worker({
      db,
      workerId: "test-worker-logging",
      onLog: (entry) => logEvents.push(entry),
      getStageExecutor: () => mockExecutor,
    });

    const claimed = jobRepo.claimNextJob("test-worker-logging", 30000);
    expect(claimed).not.toBeNull();
    if (!claimed) return;

    await worker.processJob(claimed);

    const successLog = logEvents.find((e) => e.result === "success");
    expect(successLog).toBeDefined();
    expect(successLog?.worker_id).toBe("test-worker-logging");
    expect(successLog?.job_id).toBe(job.id);
    expect(successLog?.stage).toBe("prepare");
    expect(successLog?.attempt).toBe(1);
    expect(typeof successLog?.duration_ms).toBe("number");
  });

  it("releases active lease back to pending upon graceful shutdown (XFM-26)", async () => {
    const { db, jobRepo, job } = setup();
    const worker = new Worker({
      db,
      workerId: "test-worker-lease-rel",
      shutdownTimeoutMs: 100,
    });

    // Manually claim job
    const claimed = jobRepo.claimNextJob("test-worker-lease-rel", 30000);
    expect(claimed?.status).toBe("claimed");

    // Put worker in a state with currentJob
    (worker as unknown as { currentJob: typeof claimed }).currentJob = claimed;

    // Trigger graceful stop
    await worker.stop();

    // Verify job lease was released back to pending
    const refreshed = jobRepo.getJob(job.id);
    expect(refreshed?.status).toBe("pending");
    expect(refreshed?.workerId).toBeNull();
  });
});
