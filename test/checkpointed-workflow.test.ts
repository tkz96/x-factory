// test/checkpointed-workflow.test.ts — End-to-end multi-stage checkpointed workflow tests (XFM-30, XFM-31).

import { describe, expect, it } from "bun:test";
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
import { Worker } from "../src/worker.js";

describe("Checkpointed Workflow Engine (XFM-30, XFM-31)", () => {
  function setup() {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(db);
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
        async execute(): Promise<StageResult> {
          return {
            status: "success",
            nextStage: "understand",
            nextRunStatus: "understanding",
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

  it("progresses sequentially across full multi-stage pipeline (prepare -> understand -> implement -> verify -> review -> deliver)", async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo, run } = setup();

    const stageResults: Record<string, StageResult> = {
      prepare: {
        status: "success",
        nextStage: "understand",
        nextRunStatus: "understanding",
        output: { prepared: true },
      },
      understand: {
        status: "success",
        nextStage: "implement",
        nextRunStatus: "implementing",
        output: { understood: true },
      },
      implement: {
        status: "success",
        nextStage: "verify",
        nextRunStatus: "verifying",
        output: { diff: "patch" },
      },
      verify: {
        status: "success",
        nextStage: "review",
        nextRunStatus: "reviewing",
        output: { passed: true },
      },
      review: {
        status: "success",
        nextStage: "deliver",
        nextRunStatus: "ready_for_pr",
        output: { approved: true },
      },
      deliver: {
        status: "success",
        nextRunStatus: "pr_created",
        output: { prUrl: "https://github.com/org/repo/pull/1" },
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
      if (!job) break;
      await worker.processJob(job);
      processedCount++;
    }

    // 6 stages processed
    expect(processedCount).toBe(6);

    // Final run status
    const finalRun = runRepo.get(run.id);
    expect(finalRun?.status).toBe("pr_created");

    // All 6 stage attempts persisted in order
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

    // All 6 jobs completed
    const allJobs = jobRepo.listJobsForRun(run.id);
    expect(allJobs.length).toBe(6);
    expect(allJobs.every((j) => j.status === "completed")).toBe(true);
  });

  it("handles bounded verification repair loops (verify failure -> retry implement) (XFM-31)", async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo, run } = setup();

    let implementCount = 0;
    let verifyCount = 0;

    const worker = new Worker({
      db,
      workerId: "worker-repair-test",
      getStageExecutor: (stage) => ({
        stage,
        async execute(ctx: StageContext): Promise<StageResult> {
          if (stage === "prepare") {
            return {
              status: "success",
              nextStage: "understand",
              nextRunStatus: "understanding",
            };
          }
          if (stage === "understand") {
            return {
              status: "success",
              nextStage: "implement",
              nextRunStatus: "implementing",
            };
          }
          if (stage === "implement") {
            implementCount++;
            return {
              status: "success",
              nextStage: "verify",
              nextRunStatus: "verifying",
            };
          }
          if (stage === "verify") {
            verifyCount++;
            if (verifyCount === 1) {
              // First verification attempt fails, requesting repair
              ctx.runRepo.update(ctx.run.id, { repairAttempts: 1 });
              return {
                status: "retry",
                nextStage: "implement",
                nextRunStatus: "implementing",
                output: { passed: false, repairAttempt: 1 },
              };
            }
            // Second attempt passes
            return {
              status: "success",
              nextStage: "review",
              nextRunStatus: "reviewing",
              output: { passed: true },
            };
          }
          if (stage === "review") {
            return {
              status: "success",
              nextRunStatus: "ready_for_pr",
            };
          }
          return { status: "failed", error: `Unexpected stage: ${stage}` };
        },
      }),
    });

    // Process all jobs in the workflow
    while (true) {
      const job = jobRepo.claimNextJob("worker-repair-test", 30000);
      if (!job) break;
      await worker.processJob(job);
    }

    // Verify implement was called twice (initial + 1 repair)
    expect(implementCount).toBe(2);
    expect(verifyCount).toBe(2);

    const finalRun = runRepo.get(run.id);
    expect(finalRun?.status).toBe("ready_for_pr");
    expect(finalRun?.repairAttempts).toBe(1);

    // Check recorded stage attempts
    const attempts = stageAttemptRepo.listForRun(run.id);
    expect(attempts.map((a) => a.stage)).toEqual([
      "prepare",
      "understand",
      "implement",
      "verify",
      "implement",
      "verify",
      "review",
    ]);
  });

  it("survives worker shutdown and resumes next pending job seamlessly on restart", async () => {
    const { db, runRepo, jobRepo, run } = setup();

    const mockExecutors: Record<string, StageExecutor> = {
      prepare: {
        stage: "prepare",
        async execute(): Promise<StageResult> {
          return {
            status: "success",
            nextStage: "understand",
            nextRunStatus: "understanding",
          };
        },
      },
      understand: {
        stage: "understand",
        async execute(): Promise<StageResult> {
          return {
            status: "success",
            nextStage: "implement",
            nextRunStatus: "implementing",
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

    // Verify progression continued to implementing
    expect(runRepo.get(run.id)?.status).toBe("implementing");
  });
});
