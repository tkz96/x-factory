// test/stabilization-cancellation.test.ts — Tests for atomic stop, stage cancellation, progression CAS, and job allowlist (v5.5).

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { CommandRepository } from "../src/db/command-repository.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import type { StageExecutor, StageResult } from "../src/executors/index.js";
import { stopRun } from "../src/runs.js";
import { Worker } from "../src/worker.js";

function setupTest() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);

  const runRepo = new RunRepository(db);
  const jobRepo = new JobRepository(db);
  const commandRepo = new CommandRepository(db);
  const eventRepo = new EventRepository(db);
  const stageAttemptRepo = new StageAttemptRepository(db);

  const run = runRepo.create({
    id: "run-cancel-test",
    projectId: "proj-1",
    projectName: "Project 1",
    ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "factory/cancel-1",
    status: "implementing",
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  });

  return {
    db,
    runRepo,
    jobRepo,
    commandRepo,
    eventRepo,
    stageAttemptRepo,
    run,
  };
}

describe("Stabilization Pass — Cancellation & Progression CAS", () => {
  // Test 4: Atomic stop
  it("atomically transitions run to stopped, cancels pending/claimed jobs, and creates targeted stop command", async () => {
    const { db, runRepo, jobRepo, commandRepo, eventRepo, run } = setupTest();

    // Create a claimed job
    const job1 = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
    });
    const claimed = jobRepo.claimNextJob("worker-stop-1", 30000);
    expect(claimed?.id).toBe(job1.id);

    // Create a pending job
    const job2 = jobRepo.createJob({
      runId: run.id,
      stage: "verify",
      status: "pending",
    });

    // Execute stopRun
    const stopped = await stopRun(run.id, {
      db,
      runRepo,
      jobRepo,
      commandRepo,
      eventRepo,
    });
    expect(stopped.status).toBe("stopped");

    // Both jobs should be cancelled
    expect(jobRepo.getJob(job1.id)?.status).toBe("cancelled");
    expect(jobRepo.getJob(job2.id)?.status).toBe("cancelled");

    // Stop command should target active worker and jobId
    const commands = commandRepo.claimPendingCommands("worker-stop-1", 30000);
    expect(commands.length).toBe(1);
    expect(commands[0]?.command).toBe("stop");
    expect(commands[0]?.targetWorkerId).toBe("worker-stop-1");
    expect((commands[0]?.payload as { jobId: string })?.jobId).toBe(job1.id);

    // Status event persisted
    const events = eventRepo.getEventsForRun(run.id);
    const stopEvents = events.filter(
      (e) =>
        e.type === "status" &&
        (e.payload as { status: string }).status === "stopped",
    );
    expect(stopEvents.length).toBe(1);
  });

  // Test 5: Stop during Verify
  it("handles stop during verify: marks stage attempt cancelled without failure handling or next job", async () => {
    const {
      db,
      runRepo,
      jobRepo,
      commandRepo,
      eventRepo,
      stageAttemptRepo,
      run,
    } = setupTest();

    runRepo.transitionRun(run.id, "implementing", "verifying");

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "verify",
      status: "pending",
    });

    const claimed = jobRepo.claimNextJob("worker-verify-stop", 30000);
    if (!claimed) throw new Error("Claim failed");

    // Mock verify executor that stops the run mid-execution
    const mockVerifyExecutor: StageExecutor = {
      stage: "verify",
      async execute(): Promise<StageResult> {
        // Run is stopped externally while verifying
        await stopRun(run.id, { db, runRepo, jobRepo, commandRepo, eventRepo });
        return {
          status: "success",
          nextStage: "review",
          nextRunStatus: "reviewing",
        };
      },
    };

    const worker = new Worker({
      db,
      workerId: "worker-verify-stop",
      getStageExecutor: () => mockVerifyExecutor,
    });

    await worker.processJob(claimed);

    // Run remains stopped
    expect(runRepo.get(run.id)?.status).toBe("stopped");

    // Job is cancelled
    expect(jobRepo.getJob(job.id)?.status).toBe("cancelled");

    // Stage attempt is marked cancelled
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts.length).toBe(1);
    expect(attempts[0]?.status).toBe("cancelled");

    // No next job created
    const jobs = jobRepo.listJobsForRun(run.id);
    expect(jobs.length).toBe(1);
  });

  // Test 6: Stop during Review
  it("handles stop during review: marks stage attempt cancelled without next job", async () => {
    const {
      db,
      runRepo,
      jobRepo,
      commandRepo,
      eventRepo,
      stageAttemptRepo,
      run,
    } = setupTest();

    runRepo.transitionRun(run.id, "implementing", "verifying");
    runRepo.transitionRun(run.id, "verifying", "reviewing");

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "review",
      status: "pending",
    });

    const claimed = jobRepo.claimNextJob("worker-review-stop", 30000);
    if (!claimed) throw new Error("Claim failed");

    const mockReviewExecutor: StageExecutor = {
      stage: "review",
      async execute(): Promise<StageResult> {
        await stopRun(run.id, { db, runRepo, jobRepo, commandRepo, eventRepo });
        return {
          status: "success",
          nextRunStatus: "ready_for_pr",
        };
      },
    };

    const worker = new Worker({
      db,
      workerId: "worker-review-stop",
      getStageExecutor: () => mockReviewExecutor,
    });

    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("stopped");
    expect(jobRepo.getJob(job.id)?.status).toBe("cancelled");
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts[0]?.status).toBe("cancelled");
    expect(jobRepo.listJobsForRun(run.id).length).toBe(1);
  });

  // Test 7: Delayed stop command
  it("completes stop command as no-op if targeted job has already finished and does not abort next job", async () => {
    const { db, commandRepo, run } = setupTest();

    const worker = new Worker({
      db,
      workerId: "worker-delayed-stop",
    });

    // Simulate worker is currently executing Job B
    let aborted = false;
    const abortCtrl = new AbortController();
    abortCtrl.signal.addEventListener("abort", () => {
      aborted = true;
    });

    (
      worker as unknown as { currentJob: { id: string; runId: string } }
    ).currentJob = {
      id: "job-B",
      runId: run.id,
    };
    (
      worker as unknown as { currentAbortController: AbortController }
    ).currentAbortController = abortCtrl;

    // Stop command arrives targeting already-finished Job A
    const stopCmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "stop",
      payload: { jobId: "job-A" },
      idempotencyKey: "stop:delayed",
      targetWorkerId: "worker-delayed-stop",
    });

    await worker.processCommand(stopCmd);

    // Stop command completed
    expect(commandRepo.getCommand(stopCmd.id)?.status).toBe("completed");

    // Job B was NOT aborted
    expect(aborted).toBe(false);
  });

  // Test 8: Progression CAS guard
  it("prevents stage progression if run was stopped or job cancelled before progression commit", async () => {
    const { db, runRepo, jobRepo, commandRepo, eventRepo, run } = setupTest();

    jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
    });
    const claimed = jobRepo.claimNextJob("worker-cas", 30000);
    if (!claimed) throw new Error("Claim failed");

    const worker = new Worker({
      db,
      workerId: "worker-cas",
    });

    // Run is stopped externally before progression commits
    await stopRun(run.id, { db, runRepo, jobRepo, commandRepo, eventRepo });

    // Worker attempts progression
    const committed = (
      worker as unknown as {
        commitStageProgression: (
          claimedJob: typeof claimed,
          expectedRunStatus: string,
          nextStage: string | undefined,
          nextRunStatus: string,
          output?: unknown,
        ) => boolean;
      }
    ).commitStageProgression(claimed, "implementing", "verify", "verifying");

    // CAS rejected!
    expect(committed).toBe(false);

    // Run remains stopped and no verify job created
    expect(runRepo.get(run.id)?.status).toBe("stopped");
    const jobs = jobRepo.listJobsForRun(run.id);
    expect(jobs.length).toBe(1);
  });

  // Test 24: Job allowlist
  it("only claims jobs whose parent run is in an executable status", () => {
    const { runRepo, jobRepo } = setupTest();

    // Create runs in paused/terminal statuses
    const runReady = runRepo.create({
      id: "run-ready-for-pr",
      projectId: "proj-1",
      projectName: "P",
      ticket: { id: "T", title: "T", acceptanceCriteria: [] },
      plan: "P",
      branch: "b",
      status: "ready_for_pr",
      artifactsDir: "/tmp",
      worktreePath: "/tmp",
    });

    jobRepo.createJob({
      runId: runReady.id,
      stage: "prepare",
      status: "pending",
    });

    // claimNextJob must NOT claim jobs for ready_for_pr
    const claimed = jobRepo.claimNextJob("worker-1", 30000);
    expect(claimed).toBeNull();
  });

  // Test 25: Cancelled job cannot be claimed
  it("does not claim cancelled jobs", () => {
    const { run, jobRepo } = setupTest();

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "implement",
      status: "pending",
    });

    jobRepo.cancelJobsForRun(run.id, "Cancelled by user");

    const claimed = jobRepo.claimNextJob("worker-1", 30000);
    expect(claimed).toBeNull();
    expect(jobRepo.getJob(job.id)?.status).toBe("cancelled");
  });
});
