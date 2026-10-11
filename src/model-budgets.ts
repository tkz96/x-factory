// src/model-budgets.ts — Daily budget enforcement per model (#281).
// Computes daily usage from recorded stage_attempts and prevents calls that would
// exceed configured requests/day or USD/day limits.

import type { DailyModelUsage } from "./db/stage-attempt-repository.js";
import { ModelUnavailableError, type ResolvedModel } from "./model-roles.js";
import type { ModelBudget } from "./shared/model-connection-types.js";
import type { ModelRoleName } from "./shared/types.js";

export class BudgetExceededError extends ModelUnavailableError {
  constructor(message: string) {
    super(message, "budget reached");
    this.name = "BudgetExceededError";
  }
}

/**
 * Checks whether the current usage meets or exceeds the model's configured daily budget.
 * Throws BudgetExceededError if requests or USD are exhausted.
 */
export function checkModelBudget(
  budget: ModelBudget,
  usage: DailyModelUsage,
  modelName?: string,
): void {
  const name = modelName ?? "model";
  const { requests, usd } = budget.perDay;

  if (requests !== undefined && usage.requests > requests) {
    throw new BudgetExceededError(
      `Model "${name}" exceeded daily budget: ${usage.requests}/${requests} requests today (UTC).`,
    );
  }

  if (usd !== undefined && usage.costUsd >= usd) {
    throw new BudgetExceededError(
      `Model "${name}" exceeded daily budget: $${usage.costUsd.toFixed(2)}/$${usd.toFixed(2)} today (UTC).`,
    );
  }
}

/**
 * Queries the stage attempt repository for today's usage and asserts that calling
 * the resolved model does not exceed its daily budget.
 */
export function assertBudgetNotExceeded(
  stageAttemptRepo: {
    getDailyUsageForModel(
      connectionId: string,
      modelId: string,
      options?: { now?: Date | undefined },
    ): DailyModelUsage;
  },
  resolved: ResolvedModel,
  now?: Date,
): void {
  const usage = stageAttemptRepo.getDailyUsageForModel(
    resolved.connectionId,
    resolved.modelId,
    now ? { now } : undefined,
  );
  checkModelBudget(resolved.budget, usage, resolved.modelId);
}

/**
 * Maps a stage to its assigned model role, or null if the stage does not use a model.
 */
export function modelRoleForStage(stage: string): ModelRoleName | null {
  if (stage === "understand" || stage === "plan" || stage === "execute")
    return "builder";
  if (stage === "review") return "reviewer";
  return null;
}
