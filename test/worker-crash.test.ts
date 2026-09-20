// test/worker-crash.test.ts — Comprehensive worker crash & restart recovery tests across all 6 stages (XFM-57).

import { describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { OperationLedgerRepository } from "../src/db/operation-ledger-repository.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import {
  DeliverExecutor,
  PrepareExecutor,
  type StageContext,
  type StageExecutor,
  type StageResult,
} from "../src/executors/index.js";
import type { RunStatus } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";

describe("Worker Crash & Restart Recovery Across All 6 Stages (XFM-57)", () => {
  const STAGES: Array<{
    stage: string;
    runStatus: RunStatus;
    expectedNextStatus: RunStatus;
    expectedNextStage?: string | undefined;
  }> = [
    {
      stage: "prepare",
      runStatus: "preparing",
      expectedNextStatus: "understanding",
      expectedNextStage: "understand",
    },
    {
      stage: "understand",
      runStatus: "understanding",
      expectedNextStatus: "implementing",
      expectedNextStage: "implement",
    },
    {
      stage: "implement",
      runStatus: "implementing",
      expectedNextStatus: "verifying",
      expectedNextStage: "verify",
    },
    {
      stage: "verify",
      runStatus: "verifying",
      expectedNextStatus: "reviewing",
      expectedNextStage: "review",
    },
    {
      stage: "review",
      runStatus: "reviewing",
      expectedNextStatus: "ready_for_pr",
      // Review reaches human approval gate, next stage undefined
    },
    {
      stage: "deliver",
      runStatus: "ready_for_pr",
      expectedNextStatus: "pr_created",
      // Deliver creates PR, no next stage
    },
  ];

  function createMockExecutor(stage: string): StageExecutor {
    return {
      stage,
      async execute(context: StageContext): Promise<StageResult> {
        switch (stage) {
          case "prepare": {
            // Use operation ledger like the real PrepareExecutor
            await context.operationLedgerRepo.executeWithLedger(
              context.run.id,
              "create_branch",
              async () => ({
                externalId: context.run.branch,
                result: { branch: context.run.branch },
              }),
            );
            return {
              status: "success",
              nextStage: "understand",
              nextRunStatus: "understanding",
              output: { prepared: true },
            };
          }
          case "understand": {
            return {
              status: "success",
              nextStage: "implement",
              nextRunStatus: "implementing",
              output: { contextSynthesized: true },
            };
          }
          case "implement": {
            return {
              status: "success",
              nextStage: "verify",
              nextRunStatus: "verifying",
              output: { implemented: true },
            };
          }
          case "verify": {
            return {
              status: "success",
              nextStage: "review",
              nextRunStatus: "reviewing",
              output: { verified: true },
            };
          }
          case "review": {
            return {
              status: "success",
              nextRunStatus: "ready_for_pr",
              output: { approved: true },
            };
          }
          case "deliver": {
            await context.operationLedgerRepo.executeWithLedger(
              context.run.id,
              "git_commit",
              async () => ({
                externalId: "commit-123",
                result: { committed: true },
              }),
            );
            await context.operationLedgerRepo.executeWithLedger(
              context.run.id,
              "create_pull_request",
              async () => ({
                externalId: "https://github.com/org/repo/pull/1",
                result: {
                  prUrl: "https://github.com/org/repo/pull/1",
                  prNumber: 1,
                },
              }),
            );
            return {
              status: "success",
              nextRunStatus: "pr_created",
              output: { prUrl: "https://github.com/org/repo/pull/1" },
            };
          }
          default:
            throw new Error(`Unexpected stage: ${stage}`);
        }
      },
    };
  }

  for (const item of STAGES) {
    it(`recovers from worker crash during '${item.stage}' stage and resumes cleanly`, async () => {
      const db = createDatabase({ path: ":memory:" });
      runMigrations(db);

      const runRepo = new RunRepository(db);
      const jobRepo = new JobRepository(db);
      const stageAttemptRepo = new StageAttemptRepository(db);

      const runId = `run-crash-${item.stage}`;
      const run = runRepo.create({
        id: runId,
        projectId: "proj-crash",
        projectName: "Crash Test Project",
        ticket: {
          id: "CRASH-1",
          title: `Crash during ${item.stage}`,
          acceptanceCriteria: ["AC-1"],
        },
        plan: "Plan",
        branch: "factory/crash-1",
        status: item.runStatus,
        artifactsDir: `/tmp/artifacts-${runId}`,
        worktreePath: `/tmp/worktrees-${runId}`,
      });

      // 1. Simulate Worker #1 creating and claiming the job
      const job = jobRepo.createJob({
        runId: run.id,
        stage: item.stage,
        status: "pending",
        maxAttempts: 3,
      });

      const pastTime = new Date(Date.now() - 60000).toISOString();
      db.prepare(`
        UPDATE jobs
        SET status = 'claimed',
            worker_id = 'crashed-worker-pid-999',
            lease_until = $pastTime,
            attempts = 1
        WHERE id = $id;
      `).run({ $pastTime: pastTime, $id: job.id });

      // Simulate attempt 1 in-flight when Worker #1 crashed
      const attempt1 = stageAttemptRepo.recordStart(run.id, item.stage, 1);
      expect(attempt1.status).toBe("running");

      // 2. Worker #2 starts up
      const mockExecutor = createMockExecutor(item.stage);
      const worker2 = new Worker({
        workerId: "surviving-worker-pid-1000",
        db,
        pollIntervalMs: 100000,
        getStageExecutor: () => mockExecutor,
      });

      // 3. Worker #2 performs startup recovery
      const recovery = await worker2.recoverOnStartup();
      expect(recovery.recoveredJobs).toBe(1);
      expect(recovery.recoveryRequiredRuns).toBe(0);

      // Attempt 1 must be marked failed
      const attempts = stageAttemptRepo.listForRun(run.id);
      expect(attempts.length).toBe(1);
      expect(attempts[0]?.status).toBe("failed");
      expect(attempts[0]?.error).toContain("terminated");

      // Job must be back to pending
      const recoveredJob = jobRepo.getJob(job.id);
      expect(recoveredJob).not.toBeNull();
      expect(recoveredJob?.status).toBe("pending");
      expect(recoveredJob?.workerId).toBeNull();
      expect(recoveredJob?.leaseUntil).toBeNull();

      // 4. Worker #2 claims and processes the re-queued job
      const claimed = jobRepo.claimNextJob(worker2.workerId, 30000);
      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(job.id);
      if (!claimed) throw new Error("Job not claimed");
      await worker2.processJob(claimed);

      // Job must now be completed
      const finishedJob = jobRepo.getJob(job.id);
      expect(finishedJob?.status).toBe("completed");

      // Attempt 2 must be recorded and marked completed
      const updatedAttempts = stageAttemptRepo.listForRun(run.id);
      expect(updatedAttempts.length).toBe(2);
      const attempt2 = updatedAttempts.find((a) => a.attempt === 2);
      expect(attempt2).toBeDefined();
      expect(attempt2?.status).toBe("completed");

      // Run status must have progressed
      const finalRun = runRepo.get(run.id);
      expect(finalRun?.status).toBe(item.expectedNextStatus);

      // If there was a next stage expected, verify that job was queued
      if (item.expectedNextStage) {
        const nextJobs = jobRepo
          .listJobsForRun(run.id)
          .filter((j) => j.stage === item.expectedNextStage);
        expect(nextJobs.length).toBe(1);
        expect(nextJobs[0]?.status).toBe("pending");
      }
    });
  }

  it("verifies real PrepareExecutor avoids duplicate branch/worktree on recovery via operation ledger", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const run = runRepo.create({
      id: "run-prep-recov",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "P-1", title: "Prep Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/P-1",
      status: "preparing",
      artifactsDir: "/tmp/artifacts-p1",
      worktreePath: "/tmp/worktrees-p1",
    });

    // Record branch creation already in ledger from crashed worker
    operationLedgerRepo.recordCompleted(
      run.id,
      "create_branch",
      "factory/P-1",
      { branch: "factory/P-1" },
    );

    let branchCreateCallCount = 0;
    let worktreeCreateCallCount = 0;

    const prepareExecutor = new PrepareExecutor({
      branchExists: async () => false,
      createBranch: async () => {
        branchCreateCallCount++;
      },
      createWorktree: async () => {
        worktreeCreateCallCount++;
        return "/tmp/worktrees-p1";
      },
      worktreeExists: async () => false,
      recordBaseline: async () => ({
        trackedFiles: new Set(["index.ts"]),
        untrackedFiles: new Set(),
      }),
      writeFile: async () => {},
      readFile: async () => "{}",
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
      status: "pending",
    });

    const worker = new Worker({
      workerId: "worker-resumed",
      db,
      getStageExecutor: () => prepareExecutor,
    });

    const claimed = jobRepo.claimNextJob(worker.workerId, 30000);
    if (!claimed) throw new Error("Job not claimed");
    await worker.processJob(claimed);

    // Branch was in ledger -> createBranch was NOT called again
    expect(branchCreateCallCount).toBe(0);
    // Worktree was not in ledger -> createWorktree was called once
    expect(worktreeCreateCallCount).toBe(1);

    const completedJob = jobRepo.getJob(job.id);
    expect(completedJob?.status).toBe("completed");
    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("understanding");
  });

  it("verifies real DeliverExecutor avoids duplicate PR creation on recovery via operation ledger", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const run = runRepo.create({
      id: "run-deliver-recov",
      projectId: "proj-1",
      projectName: "Project 1",
      ticket: { id: "D-1", title: "Deliver Test", acceptanceCriteria: [] },
      plan: "Plan",
      branch: "factory/D-1",
      status: "ready_for_pr",
      artifactsDir: "/tmp/artifacts-d1",
      worktreePath: "/tmp/worktrees-d1",
    });

    // Simulate PR creation already succeeded before crash
    operationLedgerRepo.recordCompleted(run.id, "git_commit", "commit-1", {
      committed: true,
    });
    operationLedgerRepo.recordCompleted(
      run.id,
      "create_pr",
      "https://github.com/org/repo/pull/99",
      {
        url: "https://github.com/org/repo/pull/99",
        branch: "factory/D-1",
        baseBranch: "main",
        title: "[X-Factory] D-1: Deliver Test",
      },
    );

    let prCallCount = 0;
    const deliverExecutor = new DeliverExecutor({
      recordBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      safeCommitAll: async () => {},
      push: async () => {},
      createPullRequest: async () => {
        prCallCount++;
        return "https://github.com/org/repo/pull/100";
      },
    });

    const job = jobRepo.createJob({
      runId: run.id,
      stage: "deliver",
      status: "pending",
    });

    const worker = new Worker({
      workerId: "worker-deliver-resumed",
      db,
      getStageExecutor: () => deliverExecutor,
    });

    const claimed = jobRepo.claimNextJob(worker.workerId, 30000);
    if (!claimed) throw new Error("Job not claimed");
    await worker.processJob(claimed);

    // PR was in ledger -> createPullRequest was NOT called again
    expect(prCallCount).toBe(0);

    const completedJob = jobRepo.getJob(job.id);
    expect(completedJob?.status).toBe("completed");
    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("pr_created");
    expect(updatedRun?.pullRequest?.url).toBe(
      "https://github.com/org/repo/pull/99",
    );
  });
});
