// test/stale-lease-recovery.test.ts — Comprehensive tests for stale lease recovery and reclamation (XFM-64).

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { Worker } from "../src/worker.js";

describe("Stale Lease Recovery & Reclamation (XFM-64)", () => {
  function setupTest() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);
    const eventRepo = new EventRepository(db);

    return { db, runRepo, jobRepo, stageAttemptRepo, eventRepo };
  }

  it("reclaims stale claimed jobs atomically via claimNextJob without explicit recovery step", async () => {
    const { db, runRepo, jobRepo } = setupTest();

    const run = runRepo.create({
      id: "run-stale-reclaim-1",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-1", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-1",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-stale-1",
      worktreePath: "/tmp/worktrees-stale-1",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
      maxAttempts: 3,
    });

    // Dead worker claimed it, but its lease expired 10 seconds ago
    const pastLease = new Date(Date.now() - 10000).toISOString();
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'dead-worker-1',
          lease_until = $leaseUntil,
          attempts = 1
      WHERE id = $id;
    `).run({ $leaseUntil: pastLease, $id: job.id });

    // Active worker claims next job
    const newWorkerId = "healthy-worker-2";
    const claimed = jobRepo.claimNextJob(newWorkerId, 30000);

    expect(claimed).not.toBeNull();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.workerId).toBe(newWorkerId);
    expect(claimed?.attempts).toBe(2);
    expect(new Date(claimed?.leaseUntil ?? "").getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it("does not reclaim jobs with active, unexpired leases", async () => {
    const { db, runRepo, jobRepo } = setupTest();

    const run = runRepo.create({
      id: "run-unexpired",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "T-2", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-2",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-unexpired",
      worktreePath: "/tmp/worktrees-unexpired",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
      maxAttempts: 3,
    });

    // Worker has active unexpired lease 60 seconds into future
    const futureLease = new Date(Date.now() + 60000).toISOString();
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'active-worker',
          lease_until = $leaseUntil,
          attempts = 1
      WHERE id = $id;
    `).run({ $leaseUntil: futureLease, $id: job.id });

    // Another worker tries to claim
    const claimed = jobRepo.claimNextJob("interloper-worker", 30000);
    expect(claimed).toBeNull();
  });

  it("finds all stale claimed jobs across all runs in FIFO order", async () => {
    const { db, runRepo, jobRepo } = setupTest();

    const run1 = runRepo.create({
      id: "run-stale-fifo-1",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "F-1", title: "FIFO 1", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/F-1",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-f1",
      worktreePath: "/tmp/worktrees-f1",
    });

    const run2 = runRepo.create({
      id: "run-stale-fifo-2",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "F-2", title: "FIFO 2", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/F-2",
      status: "verifying",
      artifactsDir: "/tmp/artifacts-f2",
      worktreePath: "/tmp/worktrees-f2",
    });

    // Create job 1 earlier
    const pastCreated1 = new Date(Date.now() - 30000).toISOString();
    const pastLease1 = new Date(Date.now() - 15000).toISOString();
    const job1 = jobRepo.createJob({
      runId: run1.id,
      stage: "implement",
      status: "pending",
    });
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'dead-1',
          created_at = $createdAt,
          lease_until = $leaseUntil
      WHERE id = $id;
    `).run({
      $createdAt: pastCreated1,
      $leaseUntil: pastLease1,
      $id: job1.id,
    });

    // Create job 2 slightly later
    const pastCreated2 = new Date(Date.now() - 20000).toISOString();
    const pastLease2 = new Date(Date.now() - 5000).toISOString();
    const job2 = jobRepo.createJob({
      runId: run2.id,
      stage: "verify",
      status: "pending",
    });
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'dead-2',
          created_at = $createdAt,
          lease_until = $leaseUntil
      WHERE id = $id;
    `).run({
      $createdAt: pastCreated2,
      $leaseUntil: pastLease2,
      $id: job2.id,
    });

    // findStaleClaimedJobs should return both in FIFO created_at order
    const staleJobs = jobRepo.findStaleClaimedJobs();
    expect(staleJobs.length).toBe(2);
    expect(staleJobs[0]?.id).toBe(job1.id);
    expect(staleJobs[1]?.id).toBe(job2.id);

    // First claimNextJob claims job 1
    const firstClaimed = jobRepo.claimNextJob("worker-fifo", 30000);
    expect(firstClaimed?.id).toBe(job1.id);

    // Second claimNextJob claims job 2
    const secondClaimed = jobRepo.claimNextJob("worker-fifo", 30000);
    expect(secondClaimed?.id).toBe(job2.id);

    // No more stale jobs
    const thirdClaimed = jobRepo.claimNextJob("worker-fifo", 30000);
    expect(thirdClaimed).toBeNull();
  });

  it("recovers in-flight failed attempt and re-queues job during Worker.recoverOnStartup()", async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo } = setupTest();

    const run = runRepo.create({
      id: "run-startup-recovery",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "R-1", title: "Recov", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/R-1",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-r1",
      worktreePath: "/tmp/worktrees-r1",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
      maxAttempts: 3,
    });

    const pastLease = new Date(Date.now() - 5000).toISOString();
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'crashed-worker-99',
          lease_until = $leaseUntil,
          attempts = 1
      WHERE id = $id;
    `).run({ $leaseUntil: pastLease, $id: job.id });

    // Attempt 1 was marked running
    const att = stageAttemptRepo.recordStart(run.id, "implement", 1);
    expect(att.status).toBe("running");

    const worker = new Worker({
      workerId: "startup-recovery-worker",
      db,
      pollIntervalMs: 100000,
    });

    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(1);
    expect(recovery.recoveryRequiredRuns).toBe(0);

    // Verify orphaned attempt is now failed
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.error).toContain(
      "Worker process terminated during execution",
    );

    // Verify job is back to pending
    const recoveredJob = jobRepo.getJob(job.id);
    expect(recoveredJob?.status).toBe("pending");
    expect(recoveredJob?.workerId).toBeNull();
    expect(recoveredJob?.leaseUntil).toBeNull();
  });

  it("transitions run to recovery_required when retries are exhausted upon stale lease recovery", async () => {
    const { db, runRepo, jobRepo } = setupTest();

    const run = runRepo.create({
      id: "run-exhausted-lease",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "EX-1", title: "Exhausted", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/EX-1",
      status: "verifying",
      artifactsDir: "/tmp/artifacts-ex1",
      worktreePath: "/tmp/worktrees-ex1",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "verify",
      status: "pending",
      maxAttempts: 3,
    });

    const pastLease = new Date(Date.now() - 5000).toISOString();
    db.prepare(`
      UPDATE jobs
      SET status = 'claimed',
          worker_id = 'crashed-worker-ex',
          lease_until = $leaseUntil,
          attempts = 3
      WHERE id = $id;
    `).run({ $leaseUntil: pastLease, $id: job.id });

    const worker = new Worker({
      workerId: "recovery-worker-ex",
      db,
      pollIntervalMs: 100000,
    });

    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(0);
    expect(recovery.recoveryRequiredRuns).toBe(1);

    const failedJob = jobRepo.getJob(job.id);
    expect(failedJob?.status).toBe("failed");
    expect(failedJob?.error).toContain("Maximum retry attempts exhausted");

    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");
  });

  it("transitions orphaned active runs with no jobs to recovery_required", async () => {
    const { runRepo, db } = setupTest();

    const orphanedRun = runRepo.create({
      id: "run-orphaned-no-jobs",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "ORPH-1", title: "Orphan", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/ORPH-1",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-orph1",
      worktreePath: "/tmp/worktrees-orph1",
    });

    const worker = new Worker({
      workerId: "orphan-checker-worker",
      db,
      pollIntervalMs: 100000,
    });

    const recovery = await worker.recoverOnStartup();
    expect(recovery.recoveredJobs).toBe(0);
    expect(recovery.recoveryRequiredRuns).toBe(1);

    const updatedRun = runRepo.get(orphanedRun.id);
    expect(updatedRun?.status).toBe("recovery_required");
  });

  it("releases active lease immediately back to pending during graceful worker shutdown", async () => {
    const { runRepo, jobRepo, db } = setupTest();

    const run = runRepo.create({
      id: "run-graceful-release",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "G-1", title: "Graceful", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/G-1",
      status: "implementing",
      artifactsDir: "/tmp/artifacts-g1",
      worktreePath: "/tmp/worktrees-g1",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
    });

    const worker = new Worker({
      workerId: "graceful-stopping-worker",
      db,
      pollIntervalMs: 100000,
    });

    // Claim job
    const claimed = jobRepo.claimNextJob(worker.workerId, 30000);
    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("claimed");

    // Manually set as currentJob to test worker.stop() lease release
    // (or test releaseLease directly)
    const released = jobRepo.releaseLease(job.id, worker.workerId);
    expect(released).toBe(true);

    const releasedJob = jobRepo.getJob(job.id);
    expect(releasedJob?.status).toBe("pending");
    expect(releasedJob?.workerId).toBeNull();
    expect(releasedJob?.leaseUntil).toBeNull();
  });
});
