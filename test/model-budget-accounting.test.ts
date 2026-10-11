// test/model-budget-accounting.test.ts — Daily spend and request counts
// per model are computed from recorded attempts (#281).

import { beforeEach, describe, expect, it } from "bun:test";
import type { Repositories } from "../src/composition-root.js";
import { startOfUtcDay } from "../src/db/stage-attempt-repository.js";
import type { ModelUse } from "../src/shared/types.js";
import { createTestRepositories } from "./helpers/composition.js";

let repos: Repositories;

const MODEL_A: ModelUse = {
  role: "builder",
  connectionId: "conn-1",
  connectionName: "OpenRouter",
  apiType: "openai-compatible",
  modelId: "anthropic/claude-3.5-sonnet",
};

const MODEL_B: ModelUse = {
  role: "reviewer",
  connectionId: "conn-1",
  connectionName: "OpenRouter",
  apiType: "openai-compatible",
  modelId: "openai/gpt-4o",
};

const MODEL_C: ModelUse = {
  role: "builder",
  connectionId: "conn-2",
  connectionName: "Gemini",
  apiType: "gemini",
  modelId: "gemini-2.0-flash",
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

describe("model budget accounting (#281)", () => {
  it("computes daily spend and request count for a model from attempts today", () => {
    seedRun("run-1");

    // Attempt 1 with cost $0.05
    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.stageAttempts.addUsage(a1.id, {
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.05,
    });

    // Attempt 2 with cost $0.03
    const a2 = repos.stageAttempts.recordStart("run-1", "execute", 2);
    repos.stageAttempts.recordModel(a2.id, MODEL_A);
    repos.stageAttempts.addUsage(a2.id, {
      tokensIn: 500,
      tokensOut: 100,
      costUsd: 0.03,
    });

    // Attempt 3 on a DIFFERENT model
    const a3 = repos.stageAttempts.recordStart("run-1", "review", 1);
    repos.stageAttempts.recordModel(a3.id, MODEL_B);
    repos.stageAttempts.addUsage(a3.id, {
      tokensIn: 800,
      tokensOut: 150,
      costUsd: 0.02,
    });

    const usageA = repos.stageAttempts.getDailyUsageForModel(
      MODEL_A.connectionId,
      MODEL_A.modelId,
    );
    expect(usageA.requests).toBe(2);
    expect(usageA.spendUsd).toBeCloseTo(0.08, 5);

    const usageB = repos.stageAttempts.getDailyUsageForModel(
      MODEL_B.connectionId,
      MODEL_B.modelId,
    );
    expect(usageB.requests).toBe(1);
    expect(usageB.spendUsd).toBeCloseTo(0.02, 5);

    const usageC = repos.stageAttempts.getDailyUsageForModel(
      MODEL_C.connectionId,
      MODEL_C.modelId,
    );
    expect(usageC.requests).toBe(0);
    expect(usageC.spendUsd).toBe(0);
  });

  it("excludes attempts started before today's UTC start", () => {
    seedRun("run-1");

    // An attempt recorded "yesterday"
    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.stageAttempts.addUsage(a1.id, { costUsd: 1.0 });

    // Manually push started_at to yesterday in SQLite
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    repos.db
      .prepare("UPDATE stage_attempts SET started_at = ? WHERE id = ?")
      .run(yesterday, a1.id);

    // An attempt recorded today
    const a2 = repos.stageAttempts.recordStart("run-1", "execute", 2);
    repos.stageAttempts.recordModel(a2.id, MODEL_A);
    repos.stageAttempts.addUsage(a2.id, { costUsd: 0.15 });

    const usage = repos.stageAttempts.getDailyUsageForModel(
      MODEL_A.connectionId,
      MODEL_A.modelId,
    );
    expect(usage.requests).toBe(1);
    expect(usage.spendUsd).toBeCloseTo(0.15, 5);
  });

  it("handles attempts with no usage/cost recorded yet (null cost_usd)", () => {
    seedRun("run-1");

    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    // No addUsage called: cost_usd is NULL

    const usage = repos.stageAttempts.getDailyUsageForModel(
      MODEL_A.connectionId,
      MODEL_A.modelId,
    );
    expect(usage.requests).toBe(1);
    expect(usage.spendUsd).toBe(0);
  });

  it("groups daily usage by model across all connections", () => {
    seedRun("run-1");
    seedRun("run-2");

    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.stageAttempts.addUsage(a1.id, { costUsd: 0.1 });

    const a2 = repos.stageAttempts.recordStart("run-1", "review", 1);
    repos.stageAttempts.recordModel(a2.id, MODEL_B);
    repos.stageAttempts.addUsage(a2.id, { costUsd: 0.05 });

    const a3 = repos.stageAttempts.recordStart("run-2", "execute", 1);
    repos.stageAttempts.recordModel(a3.id, MODEL_C);
    repos.stageAttempts.addUsage(a3.id, { costUsd: 0.25 });

    const byModel = repos.stageAttempts.getDailyUsageByModel();
    expect(byModel.get(`${MODEL_A.connectionId}:${MODEL_A.modelId}`)).toEqual({
      requests: 1,
      spendUsd: 0.1,
      costUsd: 0.1,
    });
    expect(byModel.get(`${MODEL_B.connectionId}:${MODEL_B.modelId}`)).toEqual({
      requests: 1,
      spendUsd: 0.05,
      costUsd: 0.05,
    });
    expect(byModel.get(`${MODEL_C.connectionId}:${MODEL_C.modelId}`)).toEqual({
      requests: 1,
      spendUsd: 0.25,
      costUsd: 0.25,
    });
  });

  it("startOfUtcDay returns the UTC start of the given date", () => {
    const d = new Date("2026-10-11T16:30:00.000Z");
    expect(startOfUtcDay(d)).toBe("2026-10-11T00:00:00.000Z");
  });
});
