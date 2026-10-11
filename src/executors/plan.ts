// src/executors/plan.ts — PlanExecutor: the Builder's implementation plan (#282).
// The plan is a real model call with read-only repository tools and it names the
// files and tests it changes; a model that can't be used fails the stage with its
// reason instead of falling back to a template plan.

import { modelStageFailureReason } from "../agent-stage.js";
import type { ReadOnlySessionFactory } from "../agents/pi.js";
import { modelUse, resolveRole, usageWithCost } from "../model-roles.js";
import { planRun } from "../plan.js";
import type { StageContext, StageExecutor, StageOutcome } from "./types.js";

export interface PlanDependencies {
  /** Resolves the Builder role's model (#282); a test seam. */
  resolveRole: typeof resolveRole;
  /** Test seam: replaces the Pi session the model call opens. */
  sessionFactory?: ReadOnlySessionFactory | undefined;
}

export const defaultPlanDeps: PlanDependencies = {
  resolveRole,
};

export class PlanExecutor implements StageExecutor {
  readonly stage = "plan";
  private deps: PlanDependencies;

  constructor(deps: Partial<PlanDependencies> = {}) {
    this.deps = { ...defaultPlanDeps, ...deps };
  }

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run, project } = context;
    const worktreePath = run.worktreePath || run.artifactsDir;

    context.emit("info", { text: "Generating execution plan…" });

    let plan: string;
    try {
      const resolved = await this.deps.resolveRole("builder");
      context.recordModel(modelUse(resolved));
      plan = await planRun({
        worktreePath,
        ticket: run.ticket,
        project,
        draft: run.plan,
        understanding: run.implementationContext,
        resolved,
        sessionFactory: this.deps.sessionFactory,
        emit: context.emit,
        onWait: (ms) =>
          context.emit("info", {
            text: `The provider is rate limiting ${resolved.modelId}; waiting ${Math.ceil(ms / 1000)} s before trying again.`,
          }),
        onUsage: (usage) => context.reportUsage(usageWithCost(resolved, usage)),
        signal: context.signal,
        checkBudget: () => context.assertBudget?.(resolved),
      });
    } catch (err: unknown) {
      const reason = modelStageFailureReason(err);
      if (reason) return { outcome: "error", error: reason };
      throw err;
    }

    return {
      outcome: "passed",
      output: {
        planReady: true,
      },
      record: {
        run: { plan },
        events: [
          {
            type: "stage_evidence",
            payload: {
              stage: "plan",
              evidence: `Generated execution plan with tasks for #${run.ticket?.id || run.id}.`,
            },
          },
        ],
      },
    };
  }
}
