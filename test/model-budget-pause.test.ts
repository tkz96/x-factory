// test/model-budget-pause.test.ts — Budget exhaustion pauses runs into recovery_required (#281).

import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { ExecuteExecutor } from "../src/executors/execute.js";
import type {
  StageContext,
  StageExecutor,
  StageOutcome,
} from "../src/executors/index.js";
import { ReviewExecutor } from "../src/executors/review.js";
import { BudgetExceededError } from "../src/model-budgets.js";
import type { ResolvedModel } from "../src/model-roles.js";
import { Worker } from "../src/worker.js";
import { baselinePathFor } from "../src/worktree-state.js";
import { ensureProject } from "./helpers/project-fixture.js";
import { testResolvedModel } from "./helpers/resolved-model.js";

function setup(status: "executing" = "executing") {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  ensureProject("proj-budget", {
    name: "Proj Budget",
    workspacePath: "/tmp/budget-worktree",
    repositoryPath: "/tmp/budget-worktree",
  });
  const run = repos.runs.create({
    id: "run-budget-1",
    projectId: "proj-budget",
    projectName: "Proj Budget",
    ticket: { id: "T-1", title: "Budget Ticket", acceptanceCriteria: [] },
    plan: "Step 1",
    branch: "factory/T-1",
    status,
    artifactsDir: mkdtempSync(path.join(tmpdir(), "budget-artifacts-")),
    worktreePath: "/tmp/budget-worktree",
  });
  return { db, repos, run };
}

describe("budget pause in StageRunner", () => {
  it("transitions run to recovery_required when an executor returns paused outcome", async () => {
    const { db, repos, run } = setup("executing");
    const job = repos.jobs.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });

    const pausingExecutor: StageExecutor = {
      stage: "execute",
      async execute(_ctx: StageContext): Promise<StageOutcome> {
        return {
          outcome: "paused",
          reason:
            'Model "gpt-4" exceeded daily budget: 10/10 requests today (UTC).',
        };
      },
    };

    const worker = new Worker({
      db,
      workerId: "w-pause-1",
      getStageExecutor: () => pausingExecutor,
    });

    await worker.stepRun(run.id);

    const updatedRun = repos.runs.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");

    // Job was rejected without retry
    const updatedJob = repos.jobs.getJob(job.id);
    expect(updatedJob?.status).toBe("failed");

    // Stage attempt was recorded with failure
    const attempts = repos.stageAttempts.listForRun(run.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]?.status).toBe("failed");
    expect(attempts[0]?.error).toContain("exceeded daily budget");

    // Status event recorded category "budget reached" and structured reason
    const events = repos.events.getEventsForRun(run.id);
    const statusEvent = events.find(
      (e) =>
        e.type === "status" &&
        (e.payload as { status?: string }).status === "recovery_required",
    );
    expect(statusEvent).toBeDefined();
    const payload = statusEvent?.payload as {
      category?: string;
      reason?: string;
      text?: string;
    };
    expect(payload.category).toBe("budget reached");
    expect(payload.reason).toContain("exceeded daily budget");
    expect(payload.text).toContain("Run paused: budget reached");
  });

  it("transitions run to recovery_required when executor throws BudgetExceededError", async () => {
    const { db, repos, run } = setup("executing");
    repos.jobs.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });

    const throwingExecutor: StageExecutor = {
      stage: "execute",
      async execute(_ctx: StageContext): Promise<StageOutcome> {
        throw new BudgetExceededError(
          'Model "claude-3-opus" exceeded daily budget: $15.50/$10.00 today (UTC).',
        );
      },
    };

    const worker = new Worker({
      db,
      workerId: "w-pause-2",
      getStageExecutor: () => throwingExecutor,
    });

    await worker.stepRun(run.id);

    const updatedRun = repos.runs.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");

    const events = repos.events.getEventsForRun(run.id);
    const statusEvent = events.find(
      (e) =>
        e.type === "status" &&
        (e.payload as { status?: string }).status === "recovery_required",
    );
    expect(statusEvent).toBeDefined();
    const payload = statusEvent?.payload as {
      category?: string;
      reason?: string;
    };
    expect(payload.category).toBe("budget reached");
    expect(payload.reason).toContain("$15.50/$10.00");
  });

  it("pauses ExecuteExecutor when builder model budget is exceeded", async () => {
    const { db, repos, run } = setup("executing");
    repos.jobs.createJob({
      runId: run.id,
      stage: "execute",
      status: "pending",
    });

    // Write recorded baseline so ExecuteExecutor doesn't fail on missing baseline
    writeFileSync(
      baselinePathFor(run.artifactsDir),
      JSON.stringify({ gitClean: true, sha: "abc", status: { ok: true } }),
    );

    const builderModel: ResolvedModel = {
      ...testResolvedModel("builder"),
      connectionId: "conn-test",
      modelId: "test-builder",
      budget: { perDay: { requests: 1 } },
    };

    // Record an attempt today so the daily budget of 1 request is reached
    const priorAttempt = repos.stageAttempts.recordStart(run.id, "execute", 1);
    repos.stageAttempts.recordModel(priorAttempt.id, {
      role: "builder",
      connectionId: "conn-test",
      connectionName: "Test Conn",
      apiType: "openai-compatible",
      modelId: "test-builder",
    });

    const executor = new ExecuteExecutor({
      resolveRole: async () => builderModel,
    });

    const worker = new Worker({
      db,
      workerId: "w-pause-builder",
      getStageExecutor: () => executor,
    });

    await worker.stepRun(run.id);

    const updatedRun = repos.runs.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");

    const events = repos.events.getEventsForRun(run.id);
    const statusEvent = events.find(
      (e) =>
        e.type === "status" &&
        (e.payload as { category?: string }).category === "budget reached",
    );
    expect(statusEvent).toBeDefined();
  });

  it("pauses ReviewExecutor when reviewer model budget is exceeded", async () => {
    const { db, repos, run } = setup("executing");
    repos.jobs.createJob({
      runId: run.id,
      stage: "review",
      status: "pending",
    });

    // Provide a verification result so review can run
    repos.runs.update(run.id, {
      verification: {
        passed: true,
        repairAttempt: 0,
        tests: {
          command: "bun test",
          exitCode: 0,
          stdout: "ok",
          stderr: "",
          passed: true,
          durationMs: 10,
        },
        diff: "test diff",
        filesChanged: ["file.ts"],
        hasPollution: false,
        summary: "ok",
      },
    });

    const reviewerModel: ResolvedModel = {
      ...testResolvedModel("reviewer"),
      connectionId: "conn-test",
      modelId: "test-reviewer",
      budget: { perDay: { usd: 1.0 } },
    };

    // Record usage exceeding the USD budget
    const priorAttempt = repos.stageAttempts.recordStart(run.id, "review", 1);
    repos.stageAttempts.recordModel(priorAttempt.id, {
      role: "reviewer",
      connectionId: "conn-test",
      connectionName: "Test Conn",
      apiType: "openai-compatible",
      modelId: "test-reviewer",
    });
    repos.stageAttempts.addUsage(priorAttempt.id, { costUsd: 1.5 });

    const executor = new ReviewExecutor({
      resolveRole: async () => reviewerModel,
    });

    const worker = new Worker({
      db,
      workerId: "w-pause-reviewer",
      getStageExecutor: () => executor,
    });

    await worker.stepRun(run.id);

    const updatedRun = repos.runs.get(run.id);
    expect(updatedRun?.status).toBe("recovery_required");

    const events = repos.events.getEventsForRun(run.id);
    const statusEvent = events.find(
      (e) =>
        e.type === "status" &&
        (e.payload as { category?: string }).category === "budget reached",
    );
    expect(statusEvent).toBeDefined();
  });
});
