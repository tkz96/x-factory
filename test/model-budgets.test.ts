// test/model-budgets.test.ts — Unit tests for model budget enforcement (#281).

import { describe, expect, it } from "bun:test";
import {
  assertBudgetNotExceeded,
  BudgetExceededError,
  checkModelBudget,
  modelRoleForStage,
} from "../src/model-budgets.js";
import type { ResolvedModel } from "../src/model-roles.js";
import type { ModelBudget } from "../src/shared/model-connection-types.js";

describe("model budgets", () => {
  it("BudgetExceededError has category 'budget reached'", () => {
    const err = new BudgetExceededError("Exceeded budget");
    expect(err.name).toBe("BudgetExceededError");
    expect(err.category).toBe("budget reached");
    expect(err.message).toBe("Exceeded budget");
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

    it("throws BudgetExceededError when request count reaches or exceeds limit", () => {
      const budget: ModelBudget = { perDay: { requests: 10 } };
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
          { requests: 12, costUsd: 0, spendUsd: 0 },
          "claude-3",
        );
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(BudgetExceededError);
        expect((err as BudgetExceededError).category).toBe("budget reached");
        expect((err as Error).message).toContain("claude-3");
        expect((err as Error).message).toContain("12/10 requests");
      }
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
    it("delegates to repo and passes when within budget", () => {
      const fakeRepo = {
        getDailyUsageForModel: () => ({
          requests: 2,
          costUsd: 0.5,
          spendUsd: 0.5,
        }),
      };
      const resolved: ResolvedModel = {
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

      expect(() => assertBudgetNotExceeded(fakeRepo, resolved)).not.toThrow();
    });

    it("throws BudgetExceededError when repo reports usage exceeding budget", () => {
      const fakeRepo = {
        getDailyUsageForModel: () => ({
          requests: 5,
          costUsd: 0.5,
          spendUsd: 0.5,
        }),
      };
      const resolved: ResolvedModel = {
        role: "builder",
        connectionId: "conn-1",
        connectionName: "Connection 1",
        apiType: "openai-compatible",
        baseUrl: "https://api.openai.com/v1",
        modelId: "gpt-4",
        apiKey: "test-key",
        details: {},
        limits: {},
        budget: { perDay: { requests: 5 } },
      };

      expect(() => assertBudgetNotExceeded(fakeRepo, resolved)).toThrow(
        BudgetExceededError,
      );
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
