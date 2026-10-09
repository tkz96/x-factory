// test/checkpointed-workflow.test.ts — End-to-end multi-stage checkpointed workflow tests (XFM-30, XFM-31).

import { beforeEach, describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import type { StageExecutor, StageOutcome } from "../src/executors/index.js";
import { Worker } from "../src/worker.js";
import { createTestRepositories } from "./helpers/composition.js";

let repos: Repositories;

beforeEach(() => {
  repos = createTestRepositories();
});

describe("Checkpointed Workflow Engine (XFM-30, XFM-31)", () => {
  function setup() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
    repos = createRepositories(db);
    const runRepo = new RunRepository(db);
    const jobRepo = new JobRepository(db);
    const stageAttemptRepo = new StageAttemptRepository(db);

    const run = runRepo.create({
      id: "run-cp-1",
      projectId: "proj-cp",
      projectName: "Checkpointed Project",
      ticket: {
        id: "CP-1",
        title: "Checkpointed Ticket",
        acceptanceCriteria: ["Atomic transitions", "Stage attempts"],
      },
      plan: "Checkpointed Plan",
      branch: "factory/CP-1",
      status: "preparing",
      artifactsDir: "/tmp/artifacts-cp",
      worktreePath: "/tmp/worktrees-cp",
    });

    // Create initial job in preparing stage
    const initialJob = jobRepo.createJob({
      runId: run.id,
      stage: "prepare",
      status: "pending",
    });

    return { db, runRepo, jobRepo, stageAttemptRepo, run, initialJob };
  }

  it("atomically commits stage attempt, run transition, and next job creation (XFM-30)", async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo, run, initialJob } = setup();

    const mockExecutors: Record<string, StageExecutor> = {
      prepare: {
        stage: "prepare",
        async execute(): Promise<StageOutcome> {
          return {
            outcome: "passed",
            output: { worktreePath: "/tmp/worktrees-cp" },
          };
        },
      },
    };

    const worker = new Worker({
      db,
      workerId: "worker-cp-test",
      getStageExecutor: (stage) => {
        const executor = mockExecutors[stage];
        if (!executor) throw new Error(`Missing executor for ${stage}`);
        return executor;
      },
    });

    // Claim initial job
    const claimed = jobRepo.claimNextJob("worker-cp-test", 30000);
    expect(claimed).not.toBeNull();
    if (!claimed) throw new Error("Job claim failed");

    // Process job
    await worker.processJob(claimed);

    // 1. Initial job marked completed
    const oldJob = jobRepo.getJob(initialJob.id);
    expect(oldJob?.status).toBe("completed");

    // 2. Stage attempt recorded with output
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts.length).toBe(1);
    const firstAttempt = attempts[0];
    if (!firstAttempt) throw new Error("Attempt not found");
    expect(firstAttempt.stage).toBe("prepare");
    expect(firstAttempt.status).toBe("completed");
    expect(firstAttempt.output).toEqual({
      worktreePath: "/tmp/worktrees-cp",
    });

    // 3. Run status transitioned to understanding
    const updatedRun = runRepo.get(run.id);
    expect(updatedRun?.status).toBe("understanding");

    // 4. Next job created in pending state
    const jobs = jobRepo.listJobsForRun(run.id);
    expect(jobs.length).toBe(2);
    const nextJob = jobs.find((j) => j.id !== initialJob.id);
    expect(nextJob?.stage).toBe("understand");
    expect(nextJob?.status).toBe("pending");
  });

  it("progresses sequentially across full multi-stage pipeline (prepare -> understand -> implement -> verify -> review -> ready_for_pr)", async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo, run } = setup();

    const stageResults: Record<string, StageOutcome> = {
      prepare: {
        outcome: "passed",
        output: { prepared: true },
      },
      understand: {
        outcome: "passed",
        output: { understood: true },
      },
      plan: {
        outcome: "passed",
        output: { planned: true },
      },
      execute: {
        outcome: "passed",
        output: { diff: "patch" },
      },
    };

    const worker = new Worker({
      db,
      workerId: "worker-pipeline-test",
      getStageExecutor: (stage) => ({
        stage,
        execute: async () => {
          const res = stageResults[stage];
          if (!res) throw new Error(`Missing result for stage ${stage}`);
          return res;
        },
      }),
    });

    // Run the pipeline by claiming and executing jobs until no more pending jobs exist
    let processedCount = 0;
    while (true) {
      const job = jobRepo.claimNextJob("worker-pipeline-test", 30000);
      if (job) {
        await worker.processJob(job);
        processedCount++;
      } else {
        const currentRun = runRepo.get(run.id);
        if (currentRun?.status === "awaiting_understanding_approval") {
          runRepo.update(run.id, { status: "planning" });
          jobRepo.createJob({
            runId: run.id,
            stage: "plan",
            status: "pending",
          });
        } else if (currentRun?.status === "awaiting_plan_approval") {
          runRepo.update(run.id, { status: "executing" });
          jobRepo.createJob({
            runId: run.id,
            stage: "execute",
            status: "pending",
          });
        } else if (currentRun?.status === "awaiting_review") {
          runRepo.update(run.id, { status: "ready_for_pr" });
        } else {
          break;
        }
      }
    }

    // 4 stages processed (paused at ready_for_pr)
    expect(processedCount).toBe(4);

    // Final run status is ready_for_pr
    const finalRun = runRepo.get(run.id);
    expect(finalRun?.status).toBe("ready_for_pr");

    // All 4 stage attempts persisted in order
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts.length).toBe(4);
    expect(attempts.map((a) => a.stage)).toEqual([
      "prepare",
      "understand",
      "plan",
      "execute",
    ]);
    expect(attempts.every((a) => a.status === "completed")).toBe(true);

    // All 4 jobs completed
    const allJobs = jobRepo.listJobsForRun(run.id);
    expect(allJobs.length).toBe(4);
    expect(allJobs.every((j) => j.status === "completed")).toBe(true);
  });

  it("delivers pull request from ready_for_pr via deliver command to pr_created", async () => {
    const { db, runRepo } = setup();
    const { CommandRepository } = await import(
      "../src/db/command-repository.js"
    );
    const { createPR } = await import("../src/runs.js");

    const commandRepo = new CommandRepository(db);

    // Set run to ready_for_pr
    runRepo.update("run-cp-1", { status: "ready_for_pr" });

    // Trigger createPR
    const prRes = await createPR(repos, "run-cp-1");
    expect(prRes.ok).toBe(true);
    expect(prRes.queued).toBe(true);

    const pendingCommands = commandRepo.claimPendingCommands(
      "worker-deliver-test",
      30000,
    );
    expect(pendingCommands.length).toBe(1);
    const cmd = pendingCommands[0];
    if (!cmd) throw new Error("Deliver command not claimed");
    expect(cmd.command).toBe("deliver");

    // Mock DeliverExecutor
    const mockDeliverExecutor = {
      stage: "deliver" as const,
      execute: async () => ({
        url: "https://github.com/org/repo/pull/42",
        branch: "factory/CP-1",
        baseBranch: "main",
        title: "Checkpointed Ticket",
      }),
    };

    const worker = new Worker({
      db,
      workerId: "worker-deliver-test",
      deliverExecutor: mockDeliverExecutor,
    });

    const claimed = commandRepo
      .claimPendingCommands(worker.workerId, 10000)
      .find((c) => c.id === cmd.id);
    if (claimed) await worker.processCommand(claimed);
    else await worker.processCommand(cmd);

    // Run status transitioned to pr_created
    const deliveredRun = runRepo.get("run-cp-1");
    expect(deliveredRun?.status).toBe("pr_created");
    expect(deliveredRun?.pullRequest?.url).toBe(
      "https://github.com/org/repo/pull/42",
    );

    // Command marked completed
    const finishedCmd = commandRepo.getCommand(cmd.id);
    expect(finishedCmd?.status).toBe("completed");
  });

  it("survives worker shutdown and resumes next pending job seamlessly on restart", async () => {
    const { db, runRepo, jobRepo, run } = setup();

    const mockExecutors: Record<string, StageExecutor> = {
      prepare: {
        stage: "prepare",
        async execute(): Promise<StageOutcome> {
          return {
            outcome: "passed",
          };
        },
      },
      understand: {
        stage: "understand",
        async execute(): Promise<StageOutcome> {
          return {
            outcome: "passed",
          };
        },
      },
    };

    const resolveMock = (stage: string) => {
      const exec = mockExecutors[stage];
      if (!exec) throw new Error(`Missing executor for ${stage}`);
      return exec;
    };

    // Worker 1 runs prepare stage and stops
    const worker1 = new Worker({
      db,
      workerId: "worker-inst-1",
      getStageExecutor: resolveMock,
    });

    const job1 = jobRepo.claimNextJob("worker-inst-1", 30000);
    if (!job1) throw new Error("Job 1 not found");
    await worker1.processJob(job1);
    await worker1.stop();

    // Verify run is in understanding state with a pending understand job
    expect(runRepo.get(run.id)?.status).toBe("understanding");
    const pendingJobs = jobRepo
      .listJobsForRun(run.id)
      .filter((j) => j.status === "pending");
    expect(pendingJobs.length).toBe(1);
    const firstPending = pendingJobs[0];
    if (!firstPending) throw new Error("Pending job not found");
    expect(firstPending.stage).toBe("understand");

    // Worker 2 starts up, claims the pending understand job, and executes it
    const worker2 = new Worker({
      db,
      workerId: "worker-inst-2",
      getStageExecutor: resolveMock,
    });

    const job2 = jobRepo.claimNextJob("worker-inst-2", 30000);
    expect(job2?.stage).toBe("understand");
    if (!job2) throw new Error("Job 2 not found");
    await worker2.processJob(job2);
    await worker2.stop();

    // Verify progression continued to awaiting_understanding_approval
    expect(runRepo.get(run.id)?.status).toBe("awaiting_understanding_approval");
  });
});
