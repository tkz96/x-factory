// test/worker-crash.test.ts — Comprehensive worker crash & restart recovery tests across all 6 stages (XFM-57).

import { describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { CommandRepository } from "../src/db/command-repository.js";
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
  type StageOutcome,
} from "../src/executors/index.js";
import type { PullRequest, RunStatus } from "../src/shared/types.js";
import { Worker } from "../src/worker.js";
import { deliveredOutcome } from "./helpers/deliver-outcome.js";

const CRASH_PR: PullRequest = {
  url: "https://github.com/org/repo/pull/1",
  branch: "factory/D-1",
  baseBranch: "main",
  title: "Crash recovery PR",
};

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
      expectedNextStatus: "awaiting_understanding_approval",
      expectedNextStage: undefined,
    },
    {
      stage: "plan",
      runStatus: "planning",
      expectedNextStatus: "awaiting_plan_approval",
      expectedNextStage: undefined,
    },
    {
      stage: "execute",
      runStatus: "executing",
      expectedNextStatus: "awaiting_review",
      expectedNextStage: undefined,
    },
  ];

  function createMockExecutor(stage: string): StageExecutor {
    return {
      stage,
      async execute(context: StageContext): Promise<StageOutcome> {
        switch (stage) {
          case "prepare": {
            // Use operation ledger like the real PrepareExecutor
            await context.ledger.execute("create_branch", async () => ({
              externalId: context.run.branch,
              result: { branch: context.run.branch },
            }));
            return {
              outcome: "passed",
              output: { prepared: true },
            };
          }
          case "understand": {
            return {
              outcome: "passed",
              output: { contextSynthesized: true },
            };
          }
          case "plan": {
            return {
              outcome: "passed",
              output: { implemented: true },
            };
          }
          case "execute": {
            return {
              outcome: "passed",
              output: { verified: true },
            };
          }
          case "deliver": {
            await context.ledger.execute("git_commit", async () => ({
              externalId: "commit-123",
              result: { committed: true },
            }));
            await context.ledger.execute("create_pull_request", async () => ({
              externalId: "https://github.com/org/repo/pull/1",
              result: {
                prUrl: "https://github.com/org/repo/pull/1",
                prNumber: 1,
              },
            }));
            return {
              outcome: "passed",
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
      loadRecordedBaseline: async () => ({
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

    const commandRepo = new CommandRepository(db);
    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `deliver:${run.id}`,
    });

    const worker = new Worker({
      workerId: "worker-deliver-resumed",
      db,
      deliverExecutor,
    });

    const claimedCmds = commandRepo.claimPendingCommands(
      "worker-deliver-resumed",
      10000,
      30_000,
    );
    expect(claimedCmds.length).toBe(1);

    if (claimedCmds[0]) await worker.processCommand(claimedCmds[0]);

    // PR was in ledger -> createPullRequest was NOT called again
    expect(prCallCount).toBe(0);

    const completedCmd = commandRepo.getCommand(cmd.id);
    expect(completedCmd?.status).toBe("completed");
    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("pr_created");
    expect(updatedRun?.pullRequest?.url).toBe(
      "https://github.com/org/repo/pull/99",
    );
  });

  it("verifies DeliverExecutor reconciles pending Git commit, push, and PR without duplicate mutations", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    const runRepo = new RunRepository(db);
    const operationLedgerRepo = new OperationLedgerRepository(db);

    const run = runRepo.create({
      id: "run-deliver-pending",
      projectId: "proj-pending",
      projectName: "Project Pending",
      ticket: {
        id: "D-2",
        title: "Deliver Pending Test",
        acceptanceCriteria: [],
      },
      plan: "Plan",
      branch: "factory/D-2",
      status: "ready_for_pr",
      artifactsDir: "/tmp/artifacts-d2",
      worktreePath: "/tmp/worktrees-d2",
    });

    // Simulate crash after mutations but before ledger completion
    operationLedgerRepo.recordPending(run.id, "git_commit", {
      preCommitSha: "sha-parent",
    });
    operationLedgerRepo.recordPending(run.id, "git_push");
    operationLedgerRepo.recordPending(run.id, "create_pr");

    let commitCallCount = 0;
    let pushCallCount = 0;
    let prCallCount = 0;

    const deliverExecutor = new DeliverExecutor({
      loadRecordedBaseline: async () => ({
        trackedFiles: new Set(),
        untrackedFiles: new Set(),
      }),
      safeCommitAll: async () => {
        commitCallCount++;
      },
      push: async () => {
        pushCallCount++;
      },
      createPullRequest: async () => {
        prCallCount++;
        return "https://github.com/org/repo/pull/101";
      },
      // Mock the reconcile helpers to simulate that the external state already matches
      getHeadMessage: async () => "[X-Factory] D-2: Deliver Pending Test",
      getHeadSha: async () => "sha-12345",
      getParentSha: async () => "sha-parent",
      getRemoteBranchSha: async () => "sha-12345",
      findExistingPullRequest: async () => ({
        url: "https://github.com/org/repo/pull/101",
        headRefName: "factory/D-2",
        headRefOid: "sha-12345",
        baseRefName: "main",
        state: "OPEN",
      }),
    });

    const commandRepo = new CommandRepository(db);
    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
      idempotencyKey: `deliver:${run.id}`,
    });

    const worker = new Worker({
      workerId: "worker-deliver-reconcile",
      db,
      deliverExecutor,
    });

    const claimedCmds = commandRepo.claimPendingCommands(
      "worker-deliver-reconcile",
      10000,
      30_000,
    );
    expect(claimedCmds.length).toBe(1);

    if (claimedCmds[0]) await worker.processCommand(claimedCmds[0]);

    // All should be reconciled, so no actual mutations are called
    expect(commitCallCount).toBe(0);
    expect(pushCallCount).toBe(0);
    expect(prCallCount).toBe(0);

    const completedCmd = commandRepo.getCommand(cmd.id);
    expect(completedCmd?.status).toBe("completed");

    // Ledger should be updated to completed
    const commitOp = operationLedgerRepo.getOperation(run.id, "git_commit");
    expect(commitOp?.status).toBe("completed");

    const pushOp = operationLedgerRepo.getOperation(run.id, "git_push");
    expect(pushOp?.status).toBe("completed");

    const prOp = operationLedgerRepo.getOperation(run.id, "create_pr");
    expect(prOp?.status).toBe("completed");
  });

  it("verifies in-process command lease expiration allows reclaim", async () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);

    const runRepo = new RunRepository(db);
    const commandRepo = new CommandRepository(db);

    const run = runRepo.create({
      id: "run-deliver-crash",
      projectId: "proj-crash",
      projectName: "Project Crash",
      ticket: {
        id: "D-3",
        title: "Deliver Crash Test",
        acceptanceCriteria: [],
      },
      plan: "Plan",
      branch: "factory/D-3",
      status: "ready_for_pr",
      artifactsDir: "/tmp/artifacts-d3",
      worktreePath: "/tmp/worktrees-d3",
    });

    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
    });

    let executorAStarted = false;
    let executorHalt = false;

    // Worker A: claims and crashes
    const workerA = new Worker({
      workerId: "worker-A-crasher",
      db,
      commandLeaseDurationMs: 150,
      // A crashed worker stops heartbeating: this one never beats within the test.
      commandHeartbeatIntervalMs: 60_000,
      deliverExecutor: {
        stage: "deliver",
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          executorAStarted = true;
          while (!executorHalt) {
            await new Promise((r) => setTimeout(r, 10));
          }
          return deliveredOutcome(CRASH_PR);
        },
      },
    });

    const p = workerA.stepCommandOnce();

    while (!executorAStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Terminate Worker A's execution/process without calling its normal shutdown path.
    // It never heartbeats (see its interval above), so its lease simply lapses.
    (workerA as unknown as { isRunning: boolean }).isRunning = false;

    // Wait for the lease to expire (commandLeaseDurationMs is 150)
    await new Promise((r) => setTimeout(r, 200));

    // Worker B: starts up and reclaims
    let executorBStarted = false;
    const workerB = new Worker({
      workerId: "worker-B-reclaimer",
      db,
      commandLeaseDurationMs: 150,
      commandHeartbeatIntervalMs: 50,
      deliverExecutor: {
        stage: "deliver",
        async execute(_ctx: StageContext): Promise<StageOutcome> {
          executorBStarted = true;
          return deliveredOutcome(CRASH_PR);
        },
      },
    });

    const claimedByB = await workerB.stepCommandOnce();
    expect(claimedByB.length).toBe(1);
    expect(claimedByB[0]?.id).toBe(cmd.id);

    // Process B's command
    if (claimedByB[0]) await workerB.processCommand(claimedByB[0]);

    expect(executorBStarted).toBe(true);

    const completedCmd = commandRepo.getCommand(cmd.id);
    expect(completedCmd?.status).toBe("completed");

    executorHalt = true; // allow A to exit
    await p;
  });

  it("verifies real subprocess crash and command lease expiration allows reclaim", async () => {
    const dbDir = path.join(process.cwd(), ".scratch");
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    const dbPath = path.join(dbDir, `crash-test-${Date.now()}.sqlite`);
    const db = createDatabase({ path: dbPath });
    runMigrations(db);

    const runRepo = new RunRepository(db);
    const commandRepo = new CommandRepository(db);

    const run = runRepo.create({
      id: "run-deliver-subproc-crash",
      projectId: "proj-crash",
      projectName: "Project Crash",
      ticket: {
        id: "D-4",
        title: "Subproc Crash Test",
        acceptanceCriteria: [],
      },
      plan: "Plan",
      branch: "factory/D-4",
      status: "ready_for_pr",
      artifactsDir: "/tmp/artifacts-d4",
      worktreePath: "/tmp/worktrees-d4",
    });

    const cmd = commandRepo.insertOrRetryCommand({
      runId: run.id,
      command: "deliver",
      payload: {},
    });

    // 1. Spawn Worker A as a separate Bun process
    const child = spawn(
      "bun",
      [path.join(import.meta.dir, "crashing-subprocess-worker.ts"), dbPath],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let executorAStarted = false;
    child.stdout.on("data", (data: Buffer) => {
      if (data.toString().includes("EXECUTOR_STARTED")) {
        executorAStarted = true;
      }
    });

    // Wait until the child process outputs EXECUTOR_STARTED
    while (!executorAStarted) {
      await new Promise((r) => setTimeout(r, 10));
    }

    // Double check that Worker A has claimed it
    const claimedCmd = commandRepo.getCommand(cmd.id);
    expect(claimedCmd?.status).toBe("claimed");
    expect(claimedCmd?.workerId).toBe("worker-subprocess-crasher");

    // 2. Terminate Worker A abruptly (SIGKILL)
    child.kill("SIGKILL");

    // Wait for process to exit and lease to expire
    // commandLeaseDurationMs is 150 in the child process
    await new Promise((r) => setTimeout(r, 250));

    // 3. Worker B reclaims the command
    let executorBStarted = false;
    const workerB = new Worker({
      workerId: "worker-B-reclaimer",
      db,
      commandLeaseDurationMs: 150,
      deliverExecutor: {
        stage: "deliver",
        async execute(): Promise<StageOutcome> {
          executorBStarted = true;
          return deliveredOutcome(CRASH_PR);
        },
      },
    });

    const claimedByB = await workerB.stepCommandOnce();
    expect(claimedByB.length).toBe(1);
    expect(claimedByB[0]?.id).toBe(cmd.id);
    expect(claimedByB[0]?.workerId).toBe("worker-B-reclaimer");

    if (claimedByB[0]) await workerB.processCommand(claimedByB[0]);

    expect(executorBStarted).toBe(true);

    const completedCmd = commandRepo.getCommand(cmd.id);
    expect(completedCmd?.status).toBe("completed");

    // Assert Worker A did not perform normal completion (e.g. output is from Worker B)
    expect(completedCmd?.workerId).toBe("worker-B-reclaimer");

    // Clean up
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    if (fs.existsSync(`${dbPath}-shm`)) fs.unlinkSync(`${dbPath}-shm`);
    if (fs.existsSync(`${dbPath}-wal`)) fs.unlinkSync(`${dbPath}-wal`);
  });
});
