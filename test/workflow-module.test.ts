// test/workflow-module.test.ts — Workflow module seams (#181): stage outcomes route through one table,
// a rejected review ends the run without retries, and resume returns a run to its stage.

import { afterEach, describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { EventRepository } from "../src/db/event-repository.js";
import { JobRepository } from "../src/db/job-repository.js";
import { runMigrations } from "../src/db/migrator.js";
import { RunRepository } from "../src/db/run-repository.js";
import { StageAttemptRepository } from "../src/db/stage-attempt-repository.js";
import { ConflictError } from "../src/errors.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
} from "../src/executors/index.js";
import { resumeRun } from "../src/runs.js";
import { Worker } from "../src/worker.js";

let repos: Repositories;

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
  afterEach(() => {});

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

  for (const legacy of ["verify", "implement"] as const) {
    it(`resume of a run whose last recorded stage is the legacy "${legacy}" returns it to executing`, async () => {
      const { db, runRepo, jobRepo, stageAttemptRepo, run } =
        setup("recovery_required");
      repos = createRepositories(db);
      stageAttemptRepo.recordStart(run.id, legacy, 1);

      const resumed = await resumeRun(repos, run.id);

      expect(resumed.status).toBe("executing");
      expect(runRepo.get(run.id)?.status).toBe("executing");
      const executeJobs = jobRepo
        .listJobsForRun(run.id)
        .filter((j) => j.stage === "execute");
      expect(executeJobs.length).toBe(1);
    });
  }

  it('resume of a run whose last recorded stage is the legacy "preparing" returns it to preparing', async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo, run } =
      setup("recovery_required");
    repos = createRepositories(db);
    stageAttemptRepo.recordStart(run.id, "preparing", 1);

    const resumed = await resumeRun(repos, run.id);

    expect(resumed.status).toBe("preparing");
    expect(runRepo.get(run.id)?.status).toBe("preparing");
    expect(
      jobRepo.listJobsForRun(run.id).filter((j) => j.stage === "prepare")
        .length,
    ).toBe(1);
  });

  it("resume skips a newer pi_checkpoint attempt and resumes the execute stage before it", async () => {
    const { db, runRepo, jobRepo, stageAttemptRepo, run } =
      setup("recovery_required");
    repos = createRepositories(db);
    stageAttemptRepo.recordStart(run.id, "execute", 1);
    stageAttemptRepo.recordStart(run.id, "pi_checkpoint", 1);

    const resumed = await resumeRun(repos, run.id);

    expect(resumed.status).toBe("executing");
    expect(runRepo.get(run.id)?.status).toBe("executing");
    expect(
      jobRepo.listJobsForRun(run.id).filter((j) => j.stage === "execute")
        .length,
    ).toBe(1);
  });

  it("resume of a run whose last recorded stage is unknown is refused with a 409", async () => {
    const { db, runRepo, stageAttemptRepo, run } = setup("recovery_required");
    repos = createRepositories(db);
    stageAttemptRepo.recordStart(run.id, "mystery_stage", 1);

    await expect(resumeRun(repos, run.id)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(runRepo.get(run.id)?.status).toBe("recovery_required");
  });

  describe("resume into deliver with an existing deliver command", () => {
    function resumeWithCommand(commandStatus: string | null) {
      const { db, runRepo, stageAttemptRepo, run } = setup("recovery_required");
      repos = createRepositories(db);
      stageAttemptRepo.recordStart(run.id, "deliver", 1);
      if (commandStatus !== null) {
        db.prepare(
          "INSERT INTO run_commands (id, run_id, command, idempotency_key, status, attempts, max_attempts, created_at) VALUES (?, ?, 'deliver', ?, ?, 0, 3, ?);",
        ).run(
          `cmd-${commandStatus}`,
          run.id,
          `deliver:${run.id}`,
          commandStatus,
          new Date().toISOString(),
        );
      }
      const commandRows = () =>
        db
          .prepare<{ status: string }, [string]>(
            "SELECT status FROM run_commands WHERE idempotency_key = ?;",
          )
          .all(`deliver:${run.id}`);
      return { runRepo, run, commandRows };
    }

    it("a pending deliver command is kept and the run returns to ready_for_pr", async () => {
      const { runRepo, run, commandRows } = resumeWithCommand("pending");
      const resumed = await resumeRun(repos, run.id);
      expect(resumed.status).toBe("ready_for_pr");
      expect(runRepo.get(run.id)?.status).toBe("ready_for_pr");
      expect(commandRows()).toEqual([{ status: "pending" }]);
    });

    it("a claimed deliver command is kept and the run returns to ready_for_pr", async () => {
      const { runRepo, run, commandRows } = resumeWithCommand("claimed");
      const resumed = await resumeRun(repos, run.id);
      expect(resumed.status).toBe("ready_for_pr");
      expect(runRepo.get(run.id)?.status).toBe("ready_for_pr");
      expect(commandRows()).toEqual([{ status: "claimed" }]);
    });

    it("a failed deliver command is reset to pending so the run is not stranded", async () => {
      const { runRepo, run, commandRows } = resumeWithCommand("failed");
      const resumed = await resumeRun(repos, run.id);
      expect(resumed.status).toBe("ready_for_pr");
      expect(runRepo.get(run.id)?.status).toBe("ready_for_pr");
      expect(commandRows()).toEqual([{ status: "pending" }]);
    });

    it("a completed deliver command refuses the resume and leaves the run in recovery_required", async () => {
      const { runRepo, run, commandRows } = resumeWithCommand("completed");
      await expect(resumeRun(repos, run.id)).rejects.toBeInstanceOf(
        ConflictError,
      );
      expect(runRepo.get(run.id)?.status).toBe("recovery_required");
      expect(commandRows()).toEqual([{ status: "completed" }]);
    });
  });

  it("a rejection on a run that cannot reach failed records why the run was left alone", async () => {
    const { db, runRepo, jobRepo, run } = setup("executing");
    const job = jobRepo.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });
    const worker = new Worker({
      db,
      workerId: "wf-worker-cannot-fail",
      getStageExecutor: () =>
        executorReturning("execute", {
          outcome: "rejected",
          reason: "Code review was not approved: Nope",
        }),
    });
    const claimed = jobRepo.claimNextJob("wf-worker-cannot-fail", 30000);
    expect(claimed?.id).toBe(job.id);
    if (!claimed) throw new Error("claim failed");
    // The run moves on while the job is claimed, so a late rejection cannot reach failed.
    runRepo.update(run.id, { status: "pr_created" });

    await worker.processJob(claimed);

    expect(runRepo.get(run.id)?.status).toBe("pr_created");
    expect(jobRepo.getJob(job.id)?.status).toBe("failed");
    const texts = new EventRepository(db)
      .getEventsForRun(run.id)
      .map((e) => (e.payload as { text?: string } | null)?.text);
    expect(texts).toContain(
      'Rejection not applied: run is in status "pr_created", which cannot transition to failed.',
    );
  });

  it("resume returns a recovery_required run to the stage it was in", async () => {
    const { db, jobRepo, stageAttemptRepo, run } = setup("recovery_required");
    repos = createRepositories(db);
    stageAttemptRepo.recordStart(run.id, "plan", 1);

    const resumed = await resumeRun(repos, run.id);

    expect(resumed.status).toBe("planning");
    const planJobs = jobRepo
      .listJobsForRun(run.id)
      .filter((j) => j.stage === "plan");
    expect(planJobs.length).toBe(1);
  });

  it("resume into deliver returns the run to ready_for_pr and enqueues the deliver command", async () => {
    const { db, runRepo, stageAttemptRepo, run } = setup("recovery_required");
    repos = createRepositories(db);
    stageAttemptRepo.recordStart(run.id, "deliver", 1);

    const resumed = await resumeRun(repos, run.id);

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
