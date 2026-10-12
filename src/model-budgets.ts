// src/model-budgets.ts — Daily budget enforcement per model (#281).
//
// A model's daily budget has two halves, with different units. Requests are
// model calls, counted one row per call in `model_calls`: a stage that prompts
// the model many times, and every retry after a 429, each counts. USD is cost,
// summed from the `stage_attempt_models` steps that reported it. A budget of N requests
// allows exactly N calls per UTC day: the call that would be the N+1th is
// refused before it is sent.

import { ModelUnavailableError, type ResolvedModel } from "./model-roles.js";
import type { ModelBudget } from "./shared/model-connection-types.js";
import type { ModelRoleName } from "./shared/types.js";

export class BudgetExceededError extends ModelUnavailableError {
  constructor(message: string) {
    super(message, "budget reached");
    this.name = "BudgetExceededError";
  }
}

/** Today's usage of one model: calls made, and the cost those calls reported. */
export interface DailyModelUsage {
  spendUsd: number;
  costUsd: number;
  requests: number;
}

/**
 * Where a budget check reads today's usage: call counts from the per-call log,
 * cost from the stage attempts that reported it (#281).
 */
export interface DailyUsageSource {
  modelCalls: {
    countForModel(
      connectionId: string,
      modelId: string,
      options?: { now?: Date | undefined },
    ): number;
  };
  stageAttempts: {
    getDailyCostForModel(
      connectionId: string,
      modelId: string,
      options?: { now?: Date | undefined },
    ): number;
  };
}

/** Today's usage for one model, composed from the two sources (#281). */
export function dailyUsageForModel(
  source: DailyUsageSource,
  connectionId: string,
  modelId: string,
  now?: Date,
): DailyModelUsage {
  const options = now ? { now } : undefined;
  const requests = source.modelCalls.countForModel(
    connectionId,
    modelId,
    options,
  );
  const costUsd = source.stageAttempts.getDailyCostForModel(
    connectionId,
    modelId,
    options,
  );
  return { requests, costUsd, spendUsd: costUsd };
}

/**
 * Checks whether another call may be made within the model's configured daily
 * budget. Throws BudgetExceededError when the day's calls are spent (N of N
 * made) or the day's USD is.
 */
export function checkModelBudget(
  budget: ModelBudget,
  usage: DailyModelUsage,
  modelName?: string,
): void {
  const name = modelName ?? "model";
  const { requests, usd } = budget.perDay;

  if (requests !== undefined && usage.requests >= requests) {
    throw new BudgetExceededError(
      `Model "${name}" reached its daily budget: ${usage.requests}/${requests} model calls today (UTC).`,
    );
  }

  if (usd !== undefined && usage.costUsd >= usd) {
    throw new BudgetExceededError(
      `Model "${name}" reached its daily budget: $${usage.costUsd.toFixed(2)}/$${usd.toFixed(2)} today (UTC).`,
    );
  }
}

/**
 * Reads today's usage for the resolved model and asserts that another call does
 * not exceed its daily budget. Called before every call the worker makes.
 */
export function assertBudgetNotExceeded(
  source: DailyUsageSource,
  resolved: ResolvedModel,
  now?: Date,
): void {
  const usage = dailyUsageForModel(
    source,
    resolved.connectionId,
    resolved.modelId,
    now,
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
