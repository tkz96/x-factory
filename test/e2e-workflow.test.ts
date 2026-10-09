// test/e2e-workflow.test.ts — End-to-end workflow execution with human approval gate boundary at ready_for_pr (XFM-67).

import { afterAll, describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
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
import { createPR } from "../src/runs.js";
import { Worker } from "../src/worker.js";

let repos: Repositories;

describe("End-to-End Deterministic Workflow with Human Approval Gate (XFM-67)", () => {
  afterAll(() => {});

  it("advances through all stages, strictly stops at ready_for_pr human gate, and completes on approval", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    repos = createRepositories(db);

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
            nextStage: undefined,
            nextRunStatus: "awaiting_understanding_approval",
            output: { understood: true },
          };
        },
      },
      plan: {
        stage: "plan",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("plan");
          return {
            status: "success",
            nextStage: undefined,
            nextRunStatus: "awaiting_plan_approval",
            output: { planned: true },
          };
        },
      },
      execute: {
        stage: "execute",
        async execute(_ctx: StageContext): Promise<StageResult> {
          stageCalls.push("execute");
          return {
            status: "success",
            nextStage: undefined,
            nextRunStatus: "awaiting_review",
            output: { executed: true },
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
      commandPollIntervalMs: 20,
      deliverExecutor: mockExecutors.deliver,
      getStageExecutor: (stg) => {
        const executor = mockExecutors[stg];
        if (!executor) {
          throw new Error(`Unknown stage executor: ${stg}`);
        }
        return executor;
      },
    });

    // 1. Start worker and wait for it to process up to awaiting_understanding_approval
    await worker.start();

    // Poll until run reaches awaiting_understanding_approval
    let timeout = Date.now() + 5000;
    while (Date.now() < timeout) {
      const current = runRepo.get(run.id);
      if (current?.status === "awaiting_understanding_approval") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(runRepo.get(run.id)?.status).toBe("awaiting_understanding_approval");

    // Manually approve understand
    runRepo.update(run.id, { status: "planning" });
    jobRepo.createJob({ runId: run.id, stage: "plan", status: "pending" });

    // Poll until run reaches awaiting_plan_approval
    timeout = Date.now() + 5000;
    while (Date.now() < timeout) {
      const current = runRepo.get(run.id);
      if (current?.status === "awaiting_plan_approval") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(runRepo.get(run.id)?.status).toBe("awaiting_plan_approval");

    // Manually approve plan
    runRepo.update(run.id, { status: "executing" });
    jobRepo.createJob({ runId: run.id, stage: "execute", status: "pending" });

    // Poll until run reaches awaiting_review
    timeout = Date.now() + 5000;
    while (Date.now() < timeout) {
      const current = runRepo.get(run.id);
      if (current?.status === "awaiting_review") break;
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(runRepo.get(run.id)?.status).toBe("awaiting_review");

    // Manually approve review (simulating human action)
    runRepo.update(run.id, { status: "ready_for_pr" });

    // 2. Assert that run has stopped at ready_for_pr
    const runAtGate = runRepo.get(run.id);
    expect(runAtGate?.status).toBe("ready_for_pr");
    expect(stageCalls).toEqual(["prepare", "understand", "plan", "execute"]);

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
    expect(stageCalls.length).toBe(4);

    // 3. Human Gate Approval: Operator clicks "Create PR"
    // Triggers deliver command via createPR into the durable WAL command queue
    await createPR(repos, run.id);

    // 4. Worker automatically claims the deliver command and creates PR
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
      "plan",
      "execute",
      "deliver",
    ]);

    // Verify exactly 5 stage attempts were recorded and all completed
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts.length).toBe(5);
    expect(attempts.map((a) => a.stage)).toEqual([
      "prepare",
      "understand",
      "plan",
      "execute",
      "deliver",
    ]);
    expect(attempts.every((a) => a.status === "completed")).toBe(true);
  });
});
