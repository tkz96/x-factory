// src/executors/index.ts — Central registry and exports for stage executors (XFM-28).

import { CheckpointExecutor } from "./checkpoint.js";
import { DeliverExecutor } from "./deliver.js";
import { ImplementExecutor } from "./implement.js";
import { PrepareExecutor } from "./prepare.js";
import { ReviewExecutor } from "./review.js";
import type { StageExecutor } from "./types.js";
import { UnderstandExecutor } from "./understand.js";
import { VerifyExecutor } from "./verify.js";

export * from "./checkpoint.js";
export * from "./deliver.js";
export * from "./implement.js";
export * from "./prepare.js";
export * from "./review.js";
export * from "./types.js";
export * from "./understand.js";
export * from "./verify.js";

const EXECUTORS: Record<string, StageExecutor> = {
  prepare: new PrepareExecutor(),
  parse_issue: new PrepareExecutor(),
  understand: new UnderstandExecutor(),
  implement: new ImplementExecutor(),
  verify: new VerifyExecutor(),
  review: new ReviewExecutor(),
  deliver: new DeliverExecutor(),
  pi_checkpoint: new CheckpointExecutor(),
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
