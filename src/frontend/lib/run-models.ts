// src/frontend/lib/run-models.ts — Words for which model did a run's work (#279).

import type {
  ModelRoleName,
  ModelUsage,
  StageModelUse,
  StageStartedPayload,
} from "../../shared/types.js";
import { formatUsd } from "./format-money.js";

/** The latest attempt a role ran on, if any. */
export function latestModelFor(
  stageModels: readonly StageModelUse[],
  role: ModelRoleName,
): StageModelUse | undefined {
  return stageModels.filter((m) => m.role === role).at(-1);
}

function compactCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "12.4K in · 2.1K out · $0.0062", or "" when nothing was reported. */
export function formatUsage(usage: ModelUsage): string {
  const parts: string[] = [];
  if (usage.tokensIn !== undefined)
    parts.push(`${compactCount(usage.tokensIn)} in`);
  if (usage.tokensOut !== undefined)
    parts.push(`${compactCount(usage.tokensOut)} out`);
  if (usage.costUsd !== undefined) parts.push(formatUsd(usage.costUsd));
  return parts.join(" · ");
}

const STAGE_VERBS: Readonly<Record<string, string>> = {
  understand: "Understanding",
  plan: "Planning",
  execute: "Coding",
  review: "Reviewing",
};

/** "Coding with gemini-x via Gemini". */
export function stageStartedText(payload: StageStartedPayload): string {
  const verb = STAGE_VERBS[payload.stage] ?? `Running ${payload.stage}`;
  return `${verb} with ${payload.model.modelId} via ${payload.model.connectionName}`;
}

/** "Coding" for a stage ID, for tables. */
export function stageLabel(stage: string): string {
  return STAGE_VERBS[stage] ?? stage;
}
