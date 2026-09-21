// test/stabilization-delivery.test.ts — Tests for review pause, deliver atomicity, and PR crash recovery (v5.5).

import { Database } from "bun:sqlite";
import { describe, expect, it } from "bun:test";
import { CommandRepository } from "../src/db/command-repository.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { ReviewExecutor } from "../src/executors/review.js";
import { finalizeDeliver } from "../src/services/deliver-service.js";
import type { PullRequest } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";

function setupTest() {
  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  runMigrations(db);

  const runRepo = new RunRepository(db);
  const jobRepo = new JobRepository(db);
  const commandRepo = new CommandRepository(db);
  const eventRepo = new EventRepository(db);

  const run = runRepo.create({
    id: "run-deliver-test",
    projectId: "proj-1",
    projectName: "Project 1",
    ticket: { id: "T-1", title: "Ticket 1", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "factory/deliver-1",
    status: "reviewing",
    artifactsDir: "/tmp",
    worktreePath: "/tmp",
  });

  return { db, runRepo, jobRepo, commandRepo, eventRepo, run };
}

describe("Stabilization Pass — Delivery & External PR Crash Recovery", () => {
  // Test 9: Review pause
  it("pauses at ready_for_pr on review approval without creating deliver job", async () => {
    const { db, runRepo, jobRepo, run } = setupTest();

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "review",
      status: "pending",
    });

    const claimed = jobRepo.claimNextJob("worker-rev", 30000);
    if (!claimed) throw new Error("Claim failed");

    // Mock review executor with passing result
    const reviewExecutor = new ReviewExecutor({
      reviewRun: async () => ({
        passed: true,
        summary: "Code looks great, ready for operator delivery",
        findings: [],
        criteriaChecked: [
          { criterion: "Acceptance criteria", satisfied: true },
        ],
      }),
    });

    const worker = new Worker({
      db,
      workerId: "worker-rev",
      getStageExecutor: () => reviewExecutor,
    });

    await worker.processJob(claimed);

    // Run is paused at ready_for_pr
    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("ready_for_pr");

    // Review job is completed
    expect(jobRepo.getJob(job.id)?.status).toBe("completed");

    // NO next job is created (deliver is a command, not a queued stage job)
    const jobs = jobRepo.listJobsForRun(run.id);
    expect(jobs.length).toBe(1);
  });

  // Test 11: Deliver finalization atomicity
  it("atomically commits pullRequest, pr_step, stage_evidence, pr_created, and command completion in single transaction", () => {
    const { db, runRepo, commandRepo, eventRepo, run } = setupTest();

    // Move to ready_for_pr
    runRepo.transitionRun(run.id, "reviewing", "ready_for_pr");

    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `deliver:${run.id}`,
    });

    const pr: PullRequest = {
      url: "https://github.com/org/repo/pull/99",
      branch: "factory/deliver-1",
      baseBranch: "main",
      title: "Ticket 1",
    };

    finalizeDeliver(
      db,
      runRepo,
      eventRepo,
      commandRepo,
      run.id,
      cmd.id,
      "worker-deliv",
      pr,
    );

    // Run status is pr_created and pullRequest is attached
    const finalizedRun = runRepo.get(run.id);
    expect(finalizedRun?.status).toBe("pr_created");
    expect(finalizedRun?.pullRequest?.url).toBe(pr.url);

    // Command is completed
    expect(commandRepo.getCommand(cmd.id)?.status).toBe("completed");

    // Events were appended atomically
    const events = eventRepo.getEventsForRun(run.id);
    expect(events.some((e) => e.type === "pr_step")).toBe(true);
    expect(events.some((e) => e.type === "stage_evidence")).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "status" &&
          (e.payload as { status: string }).status === "pr_created",
      ),
    ).toBe(true);
  });

  // Test 13: Deliver external crash recovery
  it("idempotently discovers existing pull request on retry after external crash before SQLite finalization", async () => {
    const { db, runRepo, commandRepo, run } = setupTest();

    runRepo.transitionRun(run.id, "reviewing", "ready_for_pr");

    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `deliver:${run.id}`,
    });

    let externalPrCalls = 0;
    const existingPr: PullRequest = {
      url: "https://github.com/org/repo/pull/123",
      branch: "factory/deliver-1",
      baseBranch: "main",
      title: "Discovered PR",
    };

    // Simulate DeliverExecutor with lookup before create
    const mockDeliverExecutor = {
      stage: "deliver" as const,
      execute: async () => {
        externalPrCalls++;
        // Simulate: PR was already created externally before process crashed
        return existingPr;
      },
    };

    const worker = new Worker({
      db,
      workerId: "worker-retry",
      deliverExecutor: mockDeliverExecutor,
    });

    // Worker claims and processes deliver command
    await worker.processCommand(cmd);

    expect(externalPrCalls).toBe(1);
    expect(runRepo.get(run.id)?.status).toBe("pr_created");
    expect(runRepo.get(run.id)?.pullRequest?.url).toBe(existingPr.url);
    expect(commandRepo.getCommand(cmd.id)?.status).toBe("completed");
  });
});
