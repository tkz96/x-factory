// src/frontend/lib/run-models.ts — Words for which model did a run's work (#279).

import type {
  ModelRoleName,
  ModelUsage,
  StageModelUse,
  StageStartedPayload,
} from "../../shared/types.js";

/** The latest attempt a role ran on, if any. */
export function latestModelFor(
  stageModels: readonly StageModelUse[],
  role: ModelRoleName,
): StageModelUse | undefined {
  return stageModels.filter((m) => m.role === role).at(-1);
}

/** "12.4K" for a token count; small counts stay exact. */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** What one role used over a run: the latest model, and every reported count added up. */
export interface RoleUsage extends ModelUsage {
  modelId: string;
  /** The steps that ran but reported no tokens (a coding agent may report none). */
  unreportedSteps: string[];
}

function total(
  uses: readonly StageModelUse[],
  key: keyof ModelUsage,
): number | undefined {
  const values = uses
    .map((use) => use[key])
    .filter((n): n is number => n !== undefined);
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0);
}

/** A role's usage over every stage it ran in, or undefined when it has not run yet. */
export function usageFor(
  stageModels: readonly StageModelUse[],
  role: ModelRoleName,
): RoleUsage | undefined {
  const uses = stageModels.filter((m) => m.role === role);
  const latest = uses.at(-1);
  if (!latest) return undefined;
  return {
    modelId: latest.modelId,
    tokensIn: total(uses, "tokensIn"),
    tokensOut: total(uses, "tokensOut"),
    costUsd: total(uses, "costUsd"),
    unreportedSteps: uses
      .filter(
        (use) => use.tokensIn === undefined && use.tokensOut === undefined,
      )
      .map((use) => use.step),
  };
}

const STAGE_VERBS: Readonly<Record<string, string>> = {
  understand: "Understanding",
  plan: "Planning",
  execute: "Coding",
  review: "Reviewing",
};

/** "Coding with gemini-x via Gemini"; a step names the work when there is one. */
export function stageStartedText(payload: StageStartedPayload): string {
  const work = payload.step ?? payload.stage;
  const verb = STAGE_VERBS[work] ?? `Running ${work}`;
  return `${verb} with ${payload.model.modelId} via ${payload.model.connectionName}`;
}
