// test/workflow-module.test.ts — Workflow module seams (#181): stage outcomes route through one table,
// a rejected review ends the run without retries, and resume returns a run to its stage.

import { afterEach, describe, expect, it } from "bun:test";
import { createDatabase } from "../src/db/connection.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
} from "../src/executors/index.js";
import { resumeRun, setDbForTesting } from "../src/runs.js";
import { Worker } from "../src/worker.js";

function setup(status: "executing" | "recovery_required" | "planning") {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const runRepo = new RunRepository(db);
  const jobRepo = new JobRepository(db);
  const stageAttemptRepo = new StageAttemptRepository(db);
  const run = runRepo.create({
    id: "run-wf-1",
    projectId: "proj-wf",
    projectName: "Workflow Project",
    ticket: {
      id: "WF-1",
      title: "Workflow Ticket",
      acceptanceCriteria: ["Routes"],
    },
    plan: "Workflow plan",
    branch: "factory/WF-1",
    status,
    artifactsDir: "/tmp/artifacts-wf",
    worktreePath: "/tmp/worktrees-wf",
  });
  return { db, runRepo, jobRepo, stageAttemptRepo, run };
}

function executorReturning(
  stage: string,
  outcome: StageOutcome,
): StageExecutor {
  return {
    stage,
    async execute(_context: StageContext): Promise<StageOutcome> {
      return outcome;
    },
  };
}

describe("Workflow module (#181)", () => {
  afterEach(() => {
    setDbForTesting(null);
  });

  it("a rejected review ends the run with the rejection and retries no job", async () => {
    const { db, runRepo, jobRepo, run } = setup("executing");
    const job = jobRepo.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });
    const worker = new Worker({
      db,
      workerId: "wf-worker-reject",
      getStageExecutor: () =>
        executorReturning("execute", {
          outcome: "rejected",
          reason: "Code review was not approved: Missing tests",
        }),
    });

    const claimed = jobRepo.claimNextJob("wf-worker-reject", 30000);
    expect(claimed?.id).toBe(job.id);
    if (!claimed) throw new Error("claim failed");

    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("failed");
    const jobs = jobRepo.listJobsForRun(run.id);
    expect(jobs.length).toBe(1);
    expect(jobs[0]?.status).toBe("failed");
    expect(jobs[0]?.error).toBe("Code review was not approved: Missing tests");
    expect(jobs[0]?.attempts).toBe(1);
  });

  it("a passed execute outcome routes the run to awaiting_review from the workflow table", async () => {
    const { db, runRepo, jobRepo, run } = setup("executing");
    const job = jobRepo.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });
    const worker = new Worker({
      db,
      workerId: "wf-worker-pass",
      getStageExecutor: () =>
        executorReturning("execute", {
          outcome: "passed",
          output: { ok: true },
        }),
    });

    const claimed = jobRepo.claimNextJob("wf-worker-pass", 30000);
    expect(claimed?.id).toBe(job.id);
    if (!claimed) throw new Error("claim failed");

    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("awaiting_review");
    expect(jobRepo.getJob(job.id)?.status).toBe("completed");
  });

  it("pins every passed stage outcome to its literal next status and next stage", async () => {
    const cases = [
      {
        stage: "prepare",
        from: "preparing",
        to: "understanding",
        next: "understand",
      },
      {
        stage: "understand",
        from: "understanding",
        to: "awaiting_understanding_approval",
        next: undefined,
      },
      {
        stage: "plan",
        from: "planning",
        to: "awaiting_plan_approval",
        next: undefined,
      },
      {
        stage: "execute",
        from: "executing",
        to: "awaiting_review",
        next: undefined,
      },
      {
        stage: "review",
        from: "executing",
        to: "awaiting_review",
        next: undefined,
      },
    ] as const;
    for (const c of cases) {
      const { db, runRepo, jobRepo, run } = setup("executing");
      runRepo.update(run.id, { status: c.from });
      const job = jobRepo.createJob({
        runId: run.id,
        stage: c.stage,
        status: "pending",
      });
      const worker = new Worker({
        db,
        workerId: `wf-route-${c.stage}`,
        getStageExecutor: () =>
          executorReturning(c.stage, { outcome: "passed" }),
      });
      const claimed = jobRepo.claimNextJob(`wf-route-${c.stage}`, 30000);
      expect(claimed?.id).toBe(job.id);
      if (!claimed) throw new Error("claim failed");

      await worker.processJob(claimed);

      expect(runRepo.get(run.id)?.status).toBe(c.to);
      const next = jobRepo.listJobsForRun(run.id).find((j) => j.id !== job.id);
      expect(next?.stage).toBe(c.next);
    }
  });

  it("pins a rejected review to a failed run with no retried job", async () => {
    const { db, runRepo, jobRepo, run } = setup("executing");
    const job = jobRepo.createJob({
      runId: run.id,
      stage: "review",
      status: "pending",
    });
    const worker = new Worker({
      db,
      workerId: "wf-route-review-reject",
      getStageExecutor: () =>
        executorReturning("review", {
          outcome: "rejected",
          reason: "Code review was not approved: Missing tests",
        }),
    });
    const claimed = jobRepo.claimNextJob("wf-route-review-reject", 30000);
    expect(claimed?.id).toBe(job.id);
    if (!claimed) throw new Error("claim failed");

    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("failed");
    expect(jobRepo.listJobsForRun(run.id).map((j) => j.status)).toEqual([
      "failed",
    ]);
  });

  it("resume returns a recovery_required run to the stage it was in", async () => {
    const { db, jobRepo, stageAttemptRepo, run } = setup("recovery_required");
    setDbForTesting(db);
    stageAttemptRepo.recordStart(run.id, "plan", 1);

    const resumed = await resumeRun(run.id);

    expect(resumed.status).toBe("planning");
    const planJobs = jobRepo
      .listJobsForRun(run.id)
      .filter((j) => j.stage === "plan");
    expect(planJobs.length).toBe(1);
  });

  it("resume into deliver returns the run to ready_for_pr and enqueues the deliver command", async () => {
    const { db, runRepo, stageAttemptRepo, run } = setup("recovery_required");
    setDbForTesting(db);
    stageAttemptRepo.recordStart(run.id, "deliver", 1);

    const resumed = await resumeRun(run.id);

    expect(resumed.status).toBe("ready_for_pr");
    expect(runRepo.get(run.id)?.status).toBe("ready_for_pr");
    const deliver = db
      .prepare<{ command: string; status: string }, [string]>(
        "SELECT command, status FROM run_commands WHERE idempotency_key = ?;",
      )
      .get(`deliver:${run.id}`);
    expect(deliver).toEqual({ command: "deliver", status: "pending" });
  });
});
