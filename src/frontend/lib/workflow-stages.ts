// src/frontend/lib/workflow-stages.ts — The six workflow stages: their order, their labels and the
// guard that recognises a stage name. Dependency-free on purpose: the run chat's item mapping and
// the stage grouping both import it, so it must not import either of them.

import type { WorkflowStage } from "../../shared/types.js";

/** The six stages in the order a run passes through them. */
export const STAGE_ORDER: readonly WorkflowStage[] = [
  "prepare",
  "understand",
  "plan",
  "execute",
  "review",
  "deliver",
];

/** The words a person reads for each stage. */
export const STAGE_LABELS: Readonly<Record<WorkflowStage, string>> = {
  prepare: "Prepare",
  understand: "Understand",
  plan: "Plan",
  execute: "Code",
  review: "Review",
  deliver: "Deliver",
};

export function isWorkflowStage(value: unknown): value is WorkflowStage {
  return (
    typeof value === "string" &&
    (STAGE_ORDER as readonly string[]).includes(value)
  );
}

/** The label a person reads for a stage name: the stage's own label when it is a workflow stage, else the name with its first letter capitalised. */
export function stageDisplayLabel(stage: string): string {
  if (isWorkflowStage(stage)) return STAGE_LABELS[stage];
  return stage.charAt(0).toUpperCase() + stage.slice(1);
}
