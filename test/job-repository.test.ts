// test/job-repository.test.ts — Unit tests for JobRepository atomic claiming, leases, and retries.

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";

describe("JobRepository", () => {
  function setup() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);

    // Create prerequisite run for foreign key
    const run = runRepo.create({
      id: "run-fk-1",
      projectId: "proj-1",
      projectName: "Project One",
      ticket: { id: "T-1", title: "Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/T-1",
      status: "preparing",
      artifactsDir: "/tmp/artifacts",
      worktreePath: "/tmp/worktree",
    });

    return { db, runRepo, jobRepo, run };
  }

  it("creates and retrieves jobs for a run", () => {
    const { jobRepo, run } = setup();

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
      maxAttempts: 3,
    });

    expect(job.id).toBeDefined();
    expect(job.runId).toBe(run.id);
    expect(job.stage).toBe("prepare");
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);

    const fetched = jobRepo.getJob(job.id);
    expect(fetched).not.toBeNull();
    expect(fetched?.id).toBe(job.id);

    const runJobs = jobRepo.listJobsForRun(run.id);
    expect(runJobs.length).toBe(1);
    expect(runJobs[0]?.id).toBe(job.id);
  });

  it("atomically claims jobs: only one worker succeeds", () => {
    const { jobRepo, run } = setup();

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
    });

    // Worker A claims
    const claimA = jobRepo.claimNextJob("worker-A", 30000);
    expect(claimA).not.toBeNull();
    expect(claimA?.id).toBe(job.id);
    expect(claimA?.workerId).toBe("worker-A");
    expect(claimA?.status).toBe("claimed");
    expect(claimA?.attempts).toBe(1);

    // Worker B attempts to claim the same job — must fail (return null)
    const claimB = jobRepo.claimNextJob("worker-B", 30000);
    expect(claimB).toBeNull();
  });

  it("renews lease during active execution", () => {
    const { jobRepo, run } = setup();

    const job = jobRepo.createJob({ runId: run.id, stage: "prepare" });
    const claimed = jobRepo.claimNextJob("worker-A", 30000);
    expect(claimed).not.toBeNull();

    const renewed = jobRepo.renewLease(job.id, "worker-A", 45000);
    expect(renewed).toBe(true);

    const updatedJob = jobRepo.getJob(job.id);
    expect(updatedJob?.leaseUntil).toBeDefined();
    expect(claimed?.leaseUntil).toBeDefined();
    const updatedTime = updatedJob?.leaseUntil
      ? new Date(updatedJob.leaseUntil).getTime()
      : 0;
    const claimedTime = claimed?.leaseUntil
      ? new Date(claimed.leaseUntil).getTime()
      : 0;
    expect(updatedTime).toBeGreaterThan(claimedTime);

    // Another worker cannot renew this lease
    const wrongWorkerRenew = jobRepo.renewLease(job.id, "worker-B", 45000);
    expect(wrongWorkerRenew).toBe(false);
  });

  it("reclaims expired leases when worker crashes or times out", () => {
    const { db, jobRepo, run } = setup();

    const job = jobRepo.createJob({ runId: run.id, stage: "prepare" });
    const claimed = jobRepo.claimNextJob("worker-dead", 30000);
    expect(claimed).not.toBeNull();

    // Artificially expire the lease in the past
    const past = new Date(Date.now() - 5000).toISOString();
    db.prepare("UPDATE jobs SET lease_until = ? WHERE id = ?").run(
      past,
      job.id,
    );

    // Worker B now attempts claim -> succeeds in reclaiming the job!
    const claimB = jobRepo.claimNextJob("worker-live", 30000);
    expect(claimB).not.toBeNull();
    expect(claimB?.id).toBe(job.id);
    expect(claimB?.workerId).toBe("worker-live");
    expect(claimB?.attempts).toBe(2);
  });

  it("enforces bounded retries with terminal failure", () => {
    const { jobRepo, run } = setup();

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
      maxAttempts: 2,
    });

    // Attempt 1
    jobRepo.claimNextJob("worker-1", 30000);
    const fail1 = jobRepo.failJob(job.id, "worker-1", "Transient error", 0);
    expect(fail1.willRetry).toBe(true);
    expect(fail1.attempts).toBe(1);

    const jobAfterFail1 = jobRepo.getJob(job.id);
    expect(jobAfterFail1?.status).toBe("pending");
    expect(jobAfterFail1?.error).toBe("Transient error");

    // Attempt 2
    jobRepo.claimNextJob("worker-1", 30000);
    const fail2 = jobRepo.failJob(job.id, "worker-1", "Permanent crash");
    expect(fail2.willRetry).toBe(false);
    expect(fail2.attempts).toBe(2);

    const jobAfterFail2 = jobRepo.getJob(job.id);
    expect(jobAfterFail2?.status).toBe("failed");
    expect(jobAfterFail2?.error).toBe("Permanent crash");
  });

  it("completes jobs and releases leases", () => {
    const { jobRepo, run } = setup();

    const job1 = jobRepo.createJob({ runId: run.id, stage: "prepare" });
    jobRepo.claimNextJob("worker-1", 30000);
    const completed = jobRepo.completeJob(job1.id, "worker-1");
    expect(completed).toBe(true);
    expect(jobRepo.getJob(job1.id)?.status).toBe("completed");

    const job2 = jobRepo.createJob({ runId: run.id, stage: "prepare" });
    jobRepo.claimNextJob("worker-1", 30000);
    const released = jobRepo.releaseLease(job2.id, "worker-1");
    expect(released).toBe(true);
    expect(jobRepo.getJob(job2.id)?.status).toBe("pending");
  });
});
