// test/worker-lifecycle.test.ts — Unit tests for independent Worker polling and job lifecycle.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
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
          outcome: "passed" as const,
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
          outcome: "passed" as const,
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

  it("does not burn an attempt when a worker stop releases the job, so repeated stops never strand it (#163)", async () => {
    const { db, jobRepo, runRepo, job } = setup();
    db.prepare("UPDATE jobs SET max_attempts = 3 WHERE id = ?").run(job.id);
    let nowMs = Date.now() + 60_000;
    const clock = { now: () => nowMs };

    for (let stop = 1; stop <= 4; stop++) {
      nowMs += 60_000;
      const workerId = `stopping-worker-${stop}`;
      const worker = new Worker({
        db,
        workerId,
        clock,
        shutdownTimeoutMs: 10,
      });
      const claimed = jobRepo.claimNextJob(workerId, 30_000, nowMs);
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.attempts).toBe(1);
      (worker as unknown as { currentJob: typeof claimed }).currentJob =
        claimed;
      await worker.stop();

      const released = jobRepo.getJob(job.id);
      expect(released?.status).toBe("pending");
      expect(released?.attempts).toBe(0);
    }
    expect(runRepo.get("run-w-1")?.status).toBe("preparing");
  });

  it("closes the stage attempt a stop left running when it releases the job", async () => {
    const { db, jobRepo, job } = setup();
    const attempts = new StageAttemptRepository(db);
    const claimed = jobRepo.claimNextJob("releasing-worker", 30_000);
    attempts.recordStart("run-w-1", "prepare", 1);
    const worker = new Worker({
      db,
      workerId: "releasing-worker",
      shutdownTimeoutMs: 10,
    });
    (worker as unknown as { currentJob: typeof claimed }).currentJob = claimed;
    await worker.stop();

    expect(jobRepo.getJob(job.id)?.status).toBe("pending");
    expect(attempts.listForRun("run-w-1").map((a) => a.status)).toEqual([
      "failed",
    ]);
  });

  it("sends a pending job already at its last attempt to recovery_required instead of leaving it stuck", async () => {
    const { db, jobRepo, runRepo, job } = setup();
    // The state older releases left behind: pending, with every attempt spent.
    db.prepare(
      "UPDATE jobs SET attempts = 3, max_attempts = 3, status = 'pending' WHERE id = ?",
    ).run(job.id);
    const worker = new Worker({
      db,
      workerId: "sweeping-worker",
      clock: { now: () => Date.now() + 10_000 },
    });

    expect(await worker.stepOnce()).toBeNull();

    expect(jobRepo.getJob(job.id)?.status).toBe("failed");
    expect(jobRepo.getJob(job.id)?.error).toBe(
      "Maximum retry attempts exhausted across worker lifetimes.",
    );
    expect(runRepo.get("run-w-1")?.status).toBe("recovery_required");
  });
});
