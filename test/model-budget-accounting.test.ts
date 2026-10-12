// test/model-budget-accounting.test.ts — Daily budget accounting per model: the
// requests/day count comes from one row per model call, the USD spend from the
// stage attempts that reported it (#281).

import { beforeEach, describe, expect, it } from "bun:test";
import type { Repositories } from "../src/composition-root.js";
import { startOfUtcDay } from "../src/db/utc-day.js";
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
  it("counts one row per model call, per model", () => {
    seedRun("run-1");

    // Attempt 1 makes two calls, attempt 2 (another model) makes one.
    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.modelCalls.record({
      connectionId: MODEL_A.connectionId,
      modelId: MODEL_A.modelId,
      stageAttemptId: a1.id,
    });
    repos.modelCalls.record({
      connectionId: MODEL_A.connectionId,
      modelId: MODEL_A.modelId,
      stageAttemptId: a1.id,
    });

    const a2 = repos.stageAttempts.recordStart("run-1", "review", 1);
    repos.stageAttempts.recordModel(a2.id, MODEL_B);
    repos.modelCalls.record({
      connectionId: MODEL_B.connectionId,
      modelId: MODEL_B.modelId,
      stageAttemptId: a2.id,
    });

    // The count is calls, not attempts: two attempts on model A are three calls.
    expect(
      repos.modelCalls.countForModel(MODEL_A.connectionId, MODEL_A.modelId),
    ).toBe(2);
    expect(
      repos.modelCalls.countForModel(MODEL_B.connectionId, MODEL_B.modelId),
    ).toBe(1);
    expect(
      repos.modelCalls.countForModel(MODEL_C.connectionId, MODEL_C.modelId),
    ).toBe(0);
  });

  it("sums today's cost from the attempts that reported it, per model", () => {
    seedRun("run-1");

    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.stageAttempts.addUsage(a1.id, {
      tokensIn: 1000,
      tokensOut: 200,
      costUsd: 0.05,
    });

    const a2 = repos.stageAttempts.recordStart("run-1", "execute", 2);
    repos.stageAttempts.recordModel(a2.id, MODEL_A);
    repos.stageAttempts.addUsage(a2.id, {
      tokensIn: 500,
      tokensOut: 100,
      costUsd: 0.03,
    });

    const a3 = repos.stageAttempts.recordStart("run-1", "review", 1);
    repos.stageAttempts.recordModel(a3.id, MODEL_B);
    repos.stageAttempts.addUsage(a3.id, {
      tokensIn: 800,
      tokensOut: 150,
      costUsd: 0.02,
    });

    expect(
      repos.stageAttempts.getDailyCostForModel(
        MODEL_A.connectionId,
        MODEL_A.modelId,
      ),
    ).toBeCloseTo(0.08, 5);
    expect(
      repos.stageAttempts.getDailyCostForModel(
        MODEL_B.connectionId,
        MODEL_B.modelId,
      ),
    ).toBeCloseTo(0.02, 5);
    expect(
      repos.stageAttempts.getDailyCostForModel(
        MODEL_C.connectionId,
        MODEL_C.modelId,
      ),
    ).toBe(0);
  });

  it("counts only today's calls: yesterday's are behind the UTC day boundary", () => {
    // Both calls happened, at one minute either side of the UTC day's start.
    repos.modelCalls.record({
      connectionId: MODEL_A.connectionId,
      modelId: MODEL_A.modelId,
      at: new Date("2026-10-10T23:59:00.000Z"),
    });
    repos.modelCalls.record({
      connectionId: MODEL_A.connectionId,
      modelId: MODEL_A.modelId,
      at: new Date("2026-10-11T00:00:01.000Z"),
    });

    const midDay = new Date("2026-10-11T12:00:00.000Z");
    expect(
      repos.modelCalls.countForModel(MODEL_A.connectionId, MODEL_A.modelId, {
        now: midDay,
      }),
    ).toBe(1);
    expect(
      repos.modelCalls.countForModel(MODEL_A.connectionId, MODEL_A.modelId, {
        now: new Date("2026-10-12T00:00:00.000Z"),
      }),
    ).toBe(0);
  });

  it("sums only today's cost: yesterday's attempts are behind the UTC day boundary", () => {
    seedRun("run-1");

    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.stageAttempts.addUsage(a1.id, { costUsd: 1.0 });

    // Manually push started_at to yesterday in SQLite
    const yesterday = new Date(Date.now() - 26 * 3600 * 1000).toISOString();
    repos.db
      .prepare("UPDATE stage_attempts SET started_at = ? WHERE id = ?")
      .run(yesterday, a1.id);

    const a2 = repos.stageAttempts.recordStart("run-1", "execute", 2);
    repos.stageAttempts.recordModel(a2.id, MODEL_A);
    repos.stageAttempts.addUsage(a2.id, { costUsd: 0.15 });

    expect(
      repos.stageAttempts.getDailyCostForModel(
        MODEL_A.connectionId,
        MODEL_A.modelId,
      ),
    ).toBeCloseTo(0.15, 5);
  });

  it("counts a call on an attempt that reported no cost yet, and spends nothing", () => {
    seedRun("run-1");

    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    // No addUsage called: cost_usd is NULL
    repos.modelCalls.record({
      connectionId: MODEL_A.connectionId,
      modelId: MODEL_A.modelId,
      stageAttemptId: a1.id,
    });

    expect(
      repos.modelCalls.countForModel(MODEL_A.connectionId, MODEL_A.modelId),
    ).toBe(1);
    expect(
      repos.stageAttempts.getDailyCostForModel(
        MODEL_A.connectionId,
        MODEL_A.modelId,
      ),
    ).toBe(0);
  });

  it("groups today's cost and calls by model across all connections", () => {
    seedRun("run-1");
    seedRun("run-2");

    const a1 = repos.stageAttempts.recordStart("run-1", "execute", 1);
    repos.stageAttempts.recordModel(a1.id, MODEL_A);
    repos.stageAttempts.addUsage(a1.id, { costUsd: 0.1 });
    repos.modelCalls.record({
      connectionId: MODEL_A.connectionId,
      modelId: MODEL_A.modelId,
      stageAttemptId: a1.id,
    });

    const a2 = repos.stageAttempts.recordStart("run-1", "review", 1);
    repos.stageAttempts.recordModel(a2.id, MODEL_B);
    repos.stageAttempts.addUsage(a2.id, { costUsd: 0.05 });
    repos.modelCalls.record({
      connectionId: MODEL_B.connectionId,
      modelId: MODEL_B.modelId,
      stageAttemptId: a2.id,
    });
    repos.modelCalls.record({
      connectionId: MODEL_B.connectionId,
      modelId: MODEL_B.modelId,
      stageAttemptId: a2.id,
    });

    const a3 = repos.stageAttempts.recordStart("run-2", "execute", 1);
    repos.stageAttempts.recordModel(a3.id, MODEL_C);
    repos.stageAttempts.addUsage(a3.id, { costUsd: 0.25 });
    repos.modelCalls.record({
      connectionId: MODEL_C.connectionId,
      modelId: MODEL_C.modelId,
      stageAttemptId: a3.id,
    });

    const costs = repos.stageAttempts.getDailyCostByModel();
    expect(costs.get(`${MODEL_A.connectionId}:${MODEL_A.modelId}`)).toBeCloseTo(
      0.1,
      5,
    );
    expect(costs.get(`${MODEL_B.connectionId}:${MODEL_B.modelId}`)).toBeCloseTo(
      0.05,
      5,
    );
    expect(costs.get(`${MODEL_C.connectionId}:${MODEL_C.modelId}`)).toBeCloseTo(
      0.25,
      5,
    );

    const calls = repos.modelCalls.countsByModel();
    expect(calls.get(`${MODEL_A.connectionId}:${MODEL_A.modelId}`)).toBe(1);
    expect(calls.get(`${MODEL_B.connectionId}:${MODEL_B.modelId}`)).toBe(2);
    expect(calls.get(`${MODEL_C.connectionId}:${MODEL_C.modelId}`)).toBe(1);
  });

  it("startOfUtcDay returns the UTC start of the given date", () => {
    const d = new Date("2026-10-11T16:30:00.000Z");
    expect(startOfUtcDay(d)).toBe("2026-10-11T00:00:00.000Z");
  });
});
