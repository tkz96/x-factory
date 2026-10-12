// test/stage-attempt-models.test.ts — Each stage attempt keeps the model it
// ran on and the usage reported for it, as they were at the time (#279).

import { beforeEach, describe, expect, it } from "bun:test";
import {
  createRepositories,
  type Repositories,
} from "../src/composition-root.js";
import { createDatabase } from "../src/db/connection.js";
import { loadMigrations, runMigrations } from "../src/db/migrator.js";
import { getRun, listRuns } from "../src/runs.js";
import type { ModelUse } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";

let repos: Repositories;

const GEMINI: ModelUse = {
  role: "builder",
  connectionId: "c1",
  connectionName: "Gemini",
  apiType: "gemini",
  modelId: "gemini-flash-lite-latest",
};

function seedRun(id: string) {
  repos.runs.create({
    id,
    projectId: "p",
    projectName: "P",
    ticket: { id: "T-1", title: "T", acceptanceCriteria: [] },
    plan: "",
    branch: "main",
    status: "executing",
    artifactsDir: "/tmp/a",
    worktreePath: "/tmp/w",
  });
}

beforeEach(() => {
  repos = createTestRepositories();
});

describe("stage attempt models", () => {
  it("records the model on an attempt and adds up reported usage", () => {
    seedRun("run-1");
    const attempt = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(attempt.id, GEMINI);
    repos.stageAttempts.addUsage(attempt.id, {
      tokensIn: 100,
      tokensOut: 20,
      costUsd: 0.001,
    });
    repos.stageAttempts.addUsage(attempt.id, { tokensIn: 50, tokensOut: 5 });

    expect(repos.stageAttempts.listModelsForRun("run-1")).toEqual([
      {
        ...GEMINI,
        stage: "execute",
        step: "execute",
        attempt: 1,
        startedAt: attempt.startedAt,
        tokensIn: 150,
        tokensOut: 25,
        costUsd: 0.001,
      },
    ]);
  });

  it("leaves attempts that never resolved a model out of the list", () => {
    seedRun("run-1");
    repos.stageAttempts.recordStart("run-1", "prepare", 1);
    expect(repos.stageAttempts.listModelsForRun("run-1")).toEqual([]);
  });

  it("getRun and listRuns carry each run's stage models, oldest first", () => {
    seedRun("run-1");
    seedRun("run-2");
    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, GEMINI);
    const a2 = repos.stageAttempts.recordStart("run-1", "review", 1);
    repos.stageAttempts.recordModel(a2.id, {
      ...GEMINI,
      role: "reviewer",
      modelId: "gemini-pro",
    });

    expect(getRun(repos, "run-1")?.stageModels?.map((m) => m.modelId)).toEqual([
      "gemini-flash-lite-latest",
      "gemini-pro",
    ]);
    const listed = listRuns(repos);
    expect(listed.find((r) => r.id === "run-1")?.stageModels).toHaveLength(2);
    expect(listed.find((r) => r.id === "run-2")?.stageModels).toEqual([]);
  });

  it("adds a second step to an attempt without overwriting the first, and usage goes to the latest step", () => {
    seedRun("run-1");
    const attempt = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(attempt.id, GEMINI);
    repos.stageAttempts.recordModel(
      attempt.id,
      { ...GEMINI, role: "reviewer", modelId: "gemini-pro" },
      "review",
    );
    repos.stageAttempts.addUsage(attempt.id, { tokensIn: 10, costUsd: 0.5 });

    expect(
      repos.stageAttempts
        .listModelsForRun("run-1")
        .map((m) => [m.step, m.role, m.modelId, m.tokensIn, m.costUsd]),
    ).toEqual([
      ["execute", "builder", "gemini-flash-lite-latest", undefined, undefined],
      ["review", "reviewer", "gemini-pro", 10, 0.5],
    ]);
  });
});

describe("migration 013: one row per model step", () => {
  it("keeps the model and usage an attempt recorded before steps existed", () => {
    const db = createDatabase({ path: ":memory:" });
    runMigrations(
      db,
      loadMigrations().filter((m) => m.version <= 12),
    );
    const before = createRepositories(db);
    before.runs.create({
      id: "run-old",
      projectId: "p",
      projectName: "P",
      ticket: { id: "T-1", title: "T", acceptanceCriteria: [] },
      plan: "",
      branch: "main",
      status: "executing",
      artifactsDir: "/tmp/a",
      worktreePath: "/tmp/w",
    });
    const attempt = before.stageAttempts.recordStart("run-old", "plan", 1);
    db.prepare(
      `UPDATE stage_attempts
       SET model_role = 'builder', connection_id = 'c1', connection_name = 'Gemini',
           api_type = 'gemini', model_id = 'gemini-old', tokens_in = 7,
           tokens_out = 3, cost_usd = 0.25
       WHERE id = ?`,
    ).run(attempt.id);
    before.stageAttempts.recordStart("run-old", "prepare", 1);

    runMigrations(db);
    const after = createRepositories(db);

    expect(after.stageAttempts.listModelsForRun("run-old")).toEqual([
      {
        ...GEMINI,
        modelId: "gemini-old",
        stage: "plan",
        step: "plan",
        attempt: 1,
        startedAt: attempt.startedAt,
        tokensIn: 7,
        tokensOut: 3,
        costUsd: 0.25,
      },
    ]);
    expect(after.stageAttempts.getDailyCostForModel("c1", "gemini-old")).toBe(
      0.25,
    );
  });
});
