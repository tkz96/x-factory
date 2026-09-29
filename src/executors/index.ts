// src/executors/index.ts — Central registry and exports for stage executors (XFM-28).

import { DeliverExecutor } from "./deliver.js";
import { ExecuteExecutor } from "./execute.js";
import { PlanExecutor } from "./plan.js";
import { PrepareExecutor } from "./prepare.js";
import { ReviewExecutor } from "./review.js";
import type { StageExecutor } from "./types.js";
import { UnderstandExecutor } from "./understand.js";

export * from "./deliver.js";
export * from "./execute.js";
export * from "./plan.js";
export * from "./prepare.js";
export * from "./review.js";
export * from "./types.js";
export * from "./understand.js";

const EXECUTORS: Record<string, StageExecutor> = {
  prepare: new PrepareExecutor(),
  parse_issue: new PrepareExecutor(),
  understand: new UnderstandExecutor(),
  plan: new PlanExecutor(),
  execute: new ExecuteExecutor(),
  review: new ReviewExecutor(),
  deliver: new DeliverExecutor(),
};

/**
 * Resolves a dedicated stage executor by stage name.
 */
export function getStageExecutor(stage: string): StageExecutor {
  const executor = EXECUTORS[stage];
  if (!executor) {
    throw new Error(
      `Unknown workflow stage: "${stage}". No executor registered.`,
    );
  }
  return executor;
}

/**
 * Dynamically registers or overrides a stage executor for testing or extensibility.
 */
export function registerStageExecutor(
  stage: string,
  executor: StageExecutor,
): void {
  EXECUTORS[stage] = executor;
}
