// test/model-budgets.test.ts — Unit tests for model budget enforcement (#281).

import { describe, expect, it } from "bun:test";
import {
  assertBudgetNotExceeded,
  BudgetExceededError,
  checkModelBudget,
  type DailyUsageSource,
  modelRoleForStage,
} from "../src/model-budgets.js";
import type { ResolvedModel } from "../src/model-roles.js";
import type { ModelBudget } from "../src/shared/model-connection-types.js";

describe("model budgets", () => {
  it("BudgetExceededError has category 'budget reached'", () => {
    const err = new BudgetExceededError("Budget reached");
    expect(err.name).toBe("BudgetExceededError");
    expect(err.category).toBe("budget reached");
    expect(err.message).toBe("Budget reached");
  });
  describe("checkModelBudget", () => {
    it("does not throw when no budget is configured", () => {
      const budget: ModelBudget = { perDay: {} };
      expect(() =>
        checkModelBudget(
          budget,
          { requests: 100, costUsd: 50, spendUsd: 50 },
          "gpt-4",
        ),
      ).not.toThrow();
    });

    it("does not throw when usage is below requests and usd limits", () => {
      const budget: ModelBudget = { perDay: { requests: 10, usd: 5 } };
      expect(() =>
        checkModelBudget(
          budget,
          { requests: 9, costUsd: 4.99, spendUsd: 4.99 },
          "gpt-4",
        ),
      ).not.toThrow();
    });

    it("allows requests up to the limit and throws when the limit is spent", () => {
      const budget: ModelBudget = { perDay: { requests: 10 } };
      // 9 calls made: the 10th is still allowed
      expect(() =>
        checkModelBudget(
          budget,
          { requests: 9, costUsd: 0, spendUsd: 0 },
          "claude-3",
        ),
      ).not.toThrow();

      // 10 of 10 calls spent: the next call is refused (#281)
      expect(() =>
        checkModelBudget(
          budget,
          { requests: 10, costUsd: 0, spendUsd: 0 },
          "claude-3",
        ),
      ).toThrow(BudgetExceededError);

      try {
        checkModelBudget(
          budget,
          { requests: 11, costUsd: 0, spendUsd: 0 },
          "claude-3",
        );
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        expect((err as BudgetExceededError).category).toBe("budget reached");
        expect((err as Error).message).toContain("claude-3");
        expect((err as Error).message).toContain("11/10 model calls");
      }
    });

    it("allows exactly N model calls for a requests/day budget of N (N=1 and N=2)", () => {
      // N = 1: one call is allowed, the second is refused
      const budget1: ModelBudget = { perDay: { requests: 1 } };
      expect(() =>
        checkModelBudget(
          budget1,
          { requests: 0, costUsd: 0, spendUsd: 0 },
          "model-1",
        ),
      ).not.toThrow();
      expect(() =>
        checkModelBudget(
          budget1,
          { requests: 1, costUsd: 0, spendUsd: 0 },
          "model-1",
        ),
      ).toThrow(BudgetExceededError);

      // N = 2: two calls are allowed, the third is refused
      const budget2: ModelBudget = { perDay: { requests: 2 } };
      expect(() =>
        checkModelBudget(
          budget2,
          { requests: 0, costUsd: 0, spendUsd: 0 },
          "model-2",
        ),
      ).not.toThrow();
      expect(() =>
        checkModelBudget(
          budget2,
          { requests: 1, costUsd: 0, spendUsd: 0 },
          "model-2",
        ),
      ).not.toThrow();
      expect(() =>
        checkModelBudget(
          budget2,
          { requests: 2, costUsd: 0, spendUsd: 0 },
          "model-2",
        ),
      ).toThrow(BudgetExceededError);
      expect(() =>
        checkModelBudget(
          budget2,
          { requests: 3, costUsd: 0, spendUsd: 0 },
          "model-2",
        ),
      ).toThrow(BudgetExceededError);
    });

    it("throws BudgetExceededError when cost reaches or exceeds limit", () => {
      const budget: ModelBudget = { perDay: { usd: 2.5 } };
      expect(() =>
        checkModelBudget(
          budget,
          { requests: 1, costUsd: 2.5, spendUsd: 2.5 },
          "gemini-pro",
        ),
      ).toThrow(BudgetExceededError);

      try {
        checkModelBudget(
          budget,
          { requests: 1, costUsd: 3.25, spendUsd: 3.25 },
          "gemini-pro",
        );
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        expect((err as BudgetExceededError).category).toBe("budget reached");
        expect((err as Error).message).toContain("gemini-pro");
        expect((err as Error).message).toContain("$3.25/$2.50");
      }
    });
  });

  describe("assertBudgetNotExceeded", () => {
    /** Daily usage a budget check reads: calls counted one by one, cost summed (#281). */
    function usageSource(requests: number, costUsd: number): DailyUsageSource {
      return {
        modelCalls: { countForModel: () => requests },
        stageAttempts: { getDailyCostForModel: () => costUsd },
      };
    }

    const builder: ResolvedModel = {
      role: "builder",
      connectionId: "conn-1",
      connectionName: "Connection 1",
      apiType: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4",
      apiKey: "test-key",
      details: {},
      limits: {},
      budget: { perDay: { requests: 5, usd: 1.0 } },
    };

    it("reads today's calls and cost from their two sources, and passes within budget", () => {
      expect(() =>
        assertBudgetNotExceeded(usageSource(4, 0.5), builder),
      ).not.toThrow();
    });

    it("throws BudgetExceededError when the model's calls are spent", () => {
      expect(() =>
        assertBudgetNotExceeded(usageSource(5, 0.5), builder),
      ).toThrow(BudgetExceededError);
    });

    it("throws BudgetExceededError when the model's cost is spent", () => {
      expect(() =>
        assertBudgetNotExceeded(usageSource(1, 1.0), builder),
      ).toThrow(BudgetExceededError);
    });

    it("hands the check time to both usage reads", () => {
      const asked: Array<{ source: string; now: Date | undefined }> = [];
      const when = new Date("2026-10-11T09:00:00.000Z");
      const source: DailyUsageSource = {
        modelCalls: {
          countForModel: (_connectionId, _modelId, options) => {
            asked.push({ source: "calls", now: options?.now });
            return 0;
          },
        },
        stageAttempts: {
          getDailyCostForModel: (_connectionId, _modelId, options) => {
            asked.push({ source: "cost", now: options?.now });
            return 0;
          },
        },
      };

      assertBudgetNotExceeded(source, builder, when);
      expect(asked).toEqual([
        { source: "calls", now: when },
        { source: "cost", now: when },
      ]);
    });
  });

  describe("modelRoleForStage", () => {
    it("maps execute to builder", () => {
      expect(modelRoleForStage("execute")).toBe("builder");
    });

    it("maps review to reviewer", () => {
      expect(modelRoleForStage("review")).toBe("reviewer");
    });

    it("maps understand and plan to builder, since they call the Builder model (#282)", () => {
      expect(modelRoleForStage("understand")).toBe("builder");
      expect(modelRoleForStage("plan")).toBe("builder");
    });

    it("returns null for non-model stages", () => {
      expect(modelRoleForStage("prepare")).toBeNull();
      expect(modelRoleForStage("deliver")).toBeNull();
    });
  });
});
