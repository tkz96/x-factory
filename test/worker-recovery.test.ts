// test/worker-recovery.test.ts — Unit tests for Worker Startup Recovery (XFM-36, XFM-37).

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { Worker } from "../src/worker.js";

describe("Worker Startup Recovery (XFM-36, XFM-37)", () => {
  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);

    const worker = new Worker({
      workerId: "test-recovery-worker",
      db,
      pollIntervalMs: 100000, // Do not auto-poll in unit test
    });

    return { db, runRepo, jobRepo, stageAttemptRepo, worker };
  }

  it("re-queues stale claimed jobs with remaining retry attempts", async () => {
    const { runRepo, jobRepo, stageAttemptRepo, worker, db } = setupTest();

    const run = runRepo.create({
      id: "run-recov-1",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-1",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-recov-1",
      worktreePath: "/tmp/worktrees-recov-1",
    });

    // Create claimed job with expired lease from a dead worker
    const pastTime = new Date(Date.now() - 60000).toISOString();
    const job = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
      maxAttempts: 3,
    });

    // Simulate dead worker claiming it
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'dead-worker-pid-9999',
          lease_until = $pastTime,
          attempts = 1
      WHERE id = $id;
    `).run({ $pastTime: pastTime, $id: job.id });

    // Simulate in-flight stage attempt
    const attempt = stageAttemptRepo.recordStart(run.id, "implement", 1);
    expect(attempt.status).toBe("running");

    // Run startup recovery
    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(1);
    expect(recovery.recoveryRequiredRuns).toBe(0);

    // Verify job is back to pending
    const recoveredJob = jobRepo.getJob(job.id);
    expect(recoveredJob?.status).toBe("pending");
    expect(recoveredJob?.workerId).toBeNull();
    expect(recoveredJob?.leaseUntil).toBeNull();

    // Verify orphaned attempt was marked failed
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.error).toContain("terminated");

    // Run remains in implementing state
    const currentRun = runRepo.get(run.id);
    expect(currentRun?.status).toBe("implementing");
  });

  it("transitions run to recovery_required when retries are exhausted", async () => {
    const { runRepo, jobRepo, worker, db } = setupTest();

    const run = runRepo.create({
      id: "run-recov-exhausted",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-2", title: "Test Exhausted", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-2",
      status: "verifying",
      artifactsDir: "/tmp/artifacts-recov-2",
      worktreePath: "/tmp/worktrees-recov-2",
    });

    const pastTime = new Date(Date.now() - 60000).toISOString();
    const job = jobRepo.createJob({
      runId: run.id,
      stage: "verify",
      status: "pending",
      maxAttempts: 3,
    });

    // Simulate job that has reached maximum attempts (3/3)
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'dead-worker-pid-8888',
          lease_until = $pastTime,
          attempts = 3
      WHERE id = $id;
    `).run({ $pastTime: pastTime, $id: job.id });

    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(0);
    expect(recovery.recoveryRequiredRuns).toBe(1);

    // Job is marked failed
    const failedJob = jobRepo.getJob(job.id);
    expect(failedJob?.status).toBe("failed");

    // Run is transitioned to recovery_required (XFM-37)
    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");
  });

  it("transitions orphaned active run with no pending jobs to recovery_required", async () => {
    const { runRepo, worker } = setupTest();

    // Run was in 'understanding' but no job was created (e.g. process died before enqueue)
    const run = runRepo.create({
      id: "run-recov-orphaned",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-3", title: "Test Orphaned", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-3",
      status: "understanding",
      artifactsDir: "/tmp/artifacts-recov-3",
      worktreePath: "/tmp/worktrees-recov-3",
    });

    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(0);
    expect(recovery.recoveryRequiredRuns).toBe(1);

    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");
  });

  it("leaves ready_for_pr runs alone during startup recovery", async () => {
    const { runRepo, worker } = setupTest();

    // Runs in ready_for_pr are waiting for user action, not worker jobs
    const run = runRepo.create({
      id: "run-ready-pr",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-4", title: "Test Ready PR", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-4",
      status: "ready_for_pr",
      artifactsDir: "/tmp/artifacts-ready-pr",
      worktreePath: "/tmp/worktrees-ready-pr",
    });

    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(0);
    expect(recovery.recoveryRequiredRuns).toBe(0);

    const currentRun = runRepo.get(run.id);
    expect(currentRun?.status).toBe("ready_for_pr");
  });
});
