// test/e2e-workflow.test.ts — End-to-end workflow execution with human approval gate boundary at ready_for_pr (XFM-67).

import { afterAll, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import type {
  StageContext,
  StageExecutor,
  StageResult,
} from "../src/executors/index.js";
import { setDbForTesting } from "../src/runs.js";
import { Worker } from "../src/worker.js";

describe("End-to-End Deterministic Workflow with Human Approval Gate (XFM-67)", () => {
  afterAll(() => {
    setDbForTesting(null);
  });

  it("advances through all stages, strictly stops at ready_for_pr human gate, and completes on approval", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    setDbForTesting(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);

    const runId = `run-e2e-gate-${Date.now()}`;
    const run = runRepo.create({
      id: runId,
      projectId: "proj-e2e",
      projectName: "E2E Gate Project",
      ticket: {
        id: "GATE-1",
        title: "Human Approval Gate Ticket",
        acceptanceCriteria: ["Must pause at ready_for_pr"],
      },
      plan: "1. Prep\n2. Context\n3. Code\n4. Test\n5. Review\n6. Deliver",
      branch: "factory/gate-1",
      status: "preparing",
      artifactsDir: `/tmp/artifacts-${runId}`,
      worktreePath: `/tmp/worktrees-${runId}`,
    });

    jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
      status: "pending",
    });

    const stageCalls: string[] = [];

    const mockExecutors: Record<string, StageExecutor> = {
      prepare: {
        stage: "prepare",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("prepare");
          return {
            status: "success",
            nextStage: "understand",
            nextRunStatus: "understanding",
            output: { prepared: true },
          };
        },
      },
      understand: {
        stage: "understand",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("understand");
          return {
            status: "success",
            nextStage: "implement",
            nextRunStatus: "implementing",
            output: { understood: true },
          };
        },
      },
      implement: {
        stage: "implement",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("implement");
          return {
            status: "success",
            nextStage: "verify",
            nextRunStatus: "verifying",
            output: { implemented: true },
          };
        },
      },
      verify: {
        stage: "verify",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("verify");
          return {
            status: "success",
            nextStage: "review",
            nextRunStatus: "reviewing",
            output: { verified: true },
          };
        },
      },
      review: {
        stage: "review",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("review");
          // Reaches Human Approval Gate: NO nextStage is returned!
          return {
            status: "success",
            nextRunStatus: "ready_for_pr",
            output: { reviewScore: 98, approved: true },
          };
        },
      },
      deliver: {
        stage: "deliver",
        async execute(ctx: StageContext): Promise<StageResult> {
          stageCalls.push("deliver");
          const pr = {
            url: "https://github.com/org/repo/pull/77",
            branch: ctx.run.branch,
            baseBranch: "main",
            title: "[X-Factory] GATE-1: PR created after approval",
          };
          ctx.runRepo.update(ctx.run.id, { pullRequest: pr });
          return {
            status: "success",
            nextRunStatus: "pr_created",
            output: pr,
          };
        },
      },
    };

    const worker = new Worker({
      workerId: "e2e-worker",
      db,
      pollIntervalMs: 20,
      getStageExecutor: (stg) => {
        const executor = mockExecutors[stg];
        if (!executor) {
          throw new Error(`Unknown stage executor: ${stg}`);
        }
        return executor;
      },
    });

    // 1. Start worker and wait for it to process up to review
    await worker.start();

    // Poll until run reaches ready_for_pr
    const gateTimeout = Date.now() + 5000;
    while (Date.now() < gateTimeout) {
      const current = runRepo.get(run.id);
      if (current?.status === "ready_for_pr") break;
      await new Promise((r) => setTimeout(r, 25));
    }

    // 2. Assert that run has stopped at ready_for_pr
    const runAtGate = runRepo.get(run.id);
    expect(runAtGate?.status).toBe("ready_for_pr");
    expect(stageCalls).toEqual([
      "prepare",
      "understand",
      "implement",
      "verify",
      "review",
    ]);

    // Assert NO deliver stage has been executed yet
    expect(stageCalls.includes("deliver")).toBe(false);
    expect(runAtGate?.pullRequest).toBeNull();

    // Assert NO pending or claimed jobs exist in SQLite
    const activeJobsAtGate = jobRepo.findActiveJobsForRun(run.id);
    expect(activeJobsAtGate.length).toBe(0);

    // Let the worker idle for 100ms at the gate; verify it stays parked
    await new Promise((r) => setTimeout(r, 100));
    const stillAtGate = runRepo.get(run.id);
    expect(stillAtGate?.status).toBe("ready_for_pr");
    expect(stageCalls.length).toBe(5);

    // 3. Human Gate Approval: Operator clicks "Create PR"
    // Queue deliver job into the durable WAL queue
    jobRepo.createJob({
      runId: run.id,
      stage: "deliver",
      status: "pending",
    });

    // 4. Worker automatically claims the deliver job and creates PR
    const prTimeout = Date.now() + 5000;
    while (Date.now() < prTimeout) {
      const current = runRepo.get(run.id);
      if (current?.status === "pr_created") break;
      await new Promise((r) => setTimeout(r, 25));
    }

    await worker.stop();

    // 5. Assert final terminal state and artifacts
    const finalRun = runRepo.get(run.id);
    expect(finalRun?.status).toBe("pr_created");
    expect(finalRun?.pullRequest?.url).toBe(
      "https://github.com/org/repo/pull/77",
    );

    expect(stageCalls).toEqual([
      "prepare",
      "understand",
      "implement",
      "verify",
      "review",
      "deliver",
    ]);

    // Verify exactly 6 stage attempts were recorded and all completed
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts.length).toBe(6);
    expect(attempts.map((a) => a.stage)).toEqual([
      "prepare",
      "understand",
      "implement",
      "verify",
      "review",
      "deliver",
    ]);
    expect(attempts.every((a) => a.status === "completed")).toBe(true);
  });
});
