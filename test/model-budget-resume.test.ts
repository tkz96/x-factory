// test/model-budget-resume.test.ts — resumeRun re-checks model budget (#281).

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
  it("stays paused (throws ConflictError, status remains recovery_required) if budget is still exceeded", async () => {
    const { repos, run } = setup();

    // Record an attempt in execute stage so resumeRoute targets execute (builder)
    const attempt = repos.stageAttempts.recordStart(run.id, "execute", 1);
    repos.stageAttempts.recordModel(attempt.id, {
      role: "builder",
      connectionId: "c-resume",
      connectionName: "Resume Conn",
      apiType: "openai-compatible",
      modelId: "model-builder",
    });
    repos.stageAttempts.recordFailure(
      attempt.id,
      "Daily budget reached: 5/5 requests",
    );

    const builderModel: ResolvedModel = {
      ...testResolvedModel("builder"),
      connectionId: "c-resume",
      modelId: "model-builder",
      budget: { perDay: { requests: 1 } }, // 1 request limit, 1 attempt exists today
    };

    // Attempt to resume
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

  it("resumes successfully when budget allows it", async () => {
    const { repos, run } = setup();

    // Record an attempt in execute stage
    const attempt = repos.stageAttempts.recordStart(run.id, "execute", 1);
    repos.stageAttempts.recordModel(attempt.id, {
      role: "builder",
      connectionId: "c-resume",
      connectionName: "Resume Conn",
      apiType: "openai-compatible",
      modelId: "model-builder",
    });
    repos.stageAttempts.recordFailure(
      attempt.id,
      "Daily budget reached: 1/1 requests",
    );

    // Budget increased to 10 requests
    const builderModel: ResolvedModel = {
      ...testResolvedModel("builder"),
      connectionId: "c-resume",
      modelId: "model-builder",
      budget: { perDay: { requests: 10 } },
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

    const attempt = repos.stageAttempts.recordStart(run.id, "execute", 1);
    repos.stageAttempts.recordModel(attempt.id, {
      role: "builder",
      connectionId: "c-resume",
      connectionName: "Resume Conn",
      apiType: "openai-compatible",
      modelId: "model-builder",
    });

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
