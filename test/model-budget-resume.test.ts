// test/model-budget-resume.test.ts — resumeRun re-checks model budget (#281).
// The check reads the per-call count: a budget of N requests allows exactly N
// model calls per UTC day, and a run whose budget is spent stays paused.

import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRepositories } from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { runMigrations } from "../src/db/migrator.js";
import { ConflictError } from "../src/errors.js";
import type { ResolvedModel } from "../src/model-roles.js";
import { resumeRun } from "../src/runs.js";
import { ensureProject } from "./helpers/project-fixture.js";
import { testResolvedModel } from "./helpers/resolved-model.js";

/** Records the execute attempt resumeRoute reads, and the model it ran on. */
function recordExecuteAttempt(
  repos: ReturnType<typeof createRepositories>,
  runId: string,
  attempt: number,
): string {
  const record = repos.stageAttempts.recordStart(runId, "execute", attempt);
  repos.stageAttempts.recordModel(record.id, {
    role: "builder",
    connectionId: "c-resume",
    connectionName: "Resume Conn",
    apiType: "openai-compatible",
    modelId: "model-builder",
  });
  return record.id;
}

/** One model call on the Builder's model, at `at` (defaults to now). */
function recordCall(
  repos: ReturnType<typeof createRepositories>,
  stageAttemptId: string,
  at?: Date,
): void {
  repos.modelCalls.record({
    connectionId: "c-resume",
    modelId: "model-builder",
    stageAttemptId,
    at,
  });
}

function setup() {
  const db = createDatabase({ path: ":memory:" });
  runMigrations(db);
  const repos = createRepositories(db);
  ensureProject("proj-resume", {
    name: "Proj Resume",
    workspacePath: "/tmp/resume-worktree",
    repositoryPath: "/tmp/resume-worktree",
  });
  const run = repos.runs.create({
    id: "run-resume-1",
    projectId: "proj-resume",
    projectName: "Proj Resume",
    ticket: { id: "T-2", title: "Resume Ticket", acceptanceCriteria: [] },
    plan: "Plan",
    branch: "factory/T-2",
    status: "recovery_required",
    artifactsDir: mkdtempSync(path.join(tmpdir(), "resume-artifacts-")),
    worktreePath: "/tmp/resume-worktree",
  });
  return { db, repos, run };
}

describe("resumeRun budget re-check", () => {
  it("stays paused (throws ConflictError, status remains recovery_required) when the budget is spent", async () => {
    const { repos, run } = setup();

    // Two attempts ran today, and between them they made the one call the
    // model's budget allows.
    const attempt1 = recordExecuteAttempt(repos, run.id, 1);
    recordCall(repos, attempt1);
    const attempt2 = recordExecuteAttempt(repos, run.id, 2);
    repos.stageAttempts.recordFailure(
      attempt2,
      "Daily budget reached: 1/1 model calls today (UTC).",
    );

    const builderModel: ResolvedModel = {
      ...testResolvedModel("builder"),
      connectionId: "c-resume",
      modelId: "model-builder",
      budget: { perDay: { requests: 1 } }, // 1 call allowed, 1 call made today
    };

    // Resume is refused: the same rule the worker checks before a call (#281).
    await expect(
      resumeRun(repos, run.id, {
        resolveRole: async () => builderModel,
      }),
    ).rejects.toThrow(ConflictError);

    // Status remains recovery_required
    const unchangedRun = repos.runs.get(run.id);
    expect(unchangedRun?.status).toBe("recovery_required");

    // No job created
    const jobs = repos.jobs.listJobsForRun(run.id);
    expect(jobs).toHaveLength(0);
  });

  it("resumes when one call is left in the budget", async () => {
    const { repos, run } = setup();

    const attempt = recordExecuteAttempt(repos, run.id, 1);
    recordCall(repos, attempt);
    repos.stageAttempts.recordFailure(
      attempt,
      "Daily budget reached: 1/1 model calls today (UTC).",
    );

    // The budget was raised to 2 calls: one is left today.
    const builderModel: ResolvedModel = {
      ...testResolvedModel("builder"),
      connectionId: "c-resume",
      modelId: "model-builder",
      budget: { perDay: { requests: 2 } },
    };

    const resumed = await resumeRun(repos, run.id, {
      resolveRole: async () => builderModel,
    });

    expect(resumed.status).toBe("executing");

    const updatedRun = repos.runs.get(run.id);
    expect(updatedRun?.status).toBe("executing");

    // A new job is scheduled
    const jobs = repos.jobs.listJobsForRun(run.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.stage).toBe("execute");
    expect(jobs[0]?.status).toBe("pending");
  });

  it("resumes successfully on a new UTC day when yesterday's budget was exhausted", async () => {
    const { repos, run } = setup();

    const attempt = recordExecuteAttempt(repos, run.id, 1);
    recordCall(repos, attempt);

    const builderModel: ResolvedModel = {
      ...testResolvedModel("builder"),
      connectionId: "c-resume",
      modelId: "model-builder",
      budget: { perDay: { requests: 1 } },
    };

    // Tomorrow UTC (usage from today is not counted)
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000);

    const resumed = await resumeRun(repos, run.id, {
      resolveRole: async () => builderModel,
      now: tomorrow,
    });

    expect(resumed.status).toBe("executing");
  });
});
