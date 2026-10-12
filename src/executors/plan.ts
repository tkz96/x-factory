// src/executors/plan.ts — PlanExecutor: the Builder's implementation plan (#282).
// The plan is a real model call with read-only repository tools and it names the
// files and tests it changes; a model that can't be used fails the stage with its
// reason instead of falling back to a template plan.

import { modelStageOutcome } from "../agent-stage.js";
import type { ReadOnlySessionFactory } from "../agents/pi.js";
import {
  modelUse,
  type ResolvedModel,
  resolveRole,
  usageWithCost,
} from "../model-roles.js";
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
    let resolved: ResolvedModel | undefined;
    try {
      const model = await this.deps.resolveRole("builder");
      resolved = model;
      context.recordModel(modelUse(model));
      plan = await planRun({
        worktreePath,
        ticket: run.ticket,
        project,
        draft: run.plan,
        understanding: run.implementationContext,
        resolved: model,
        sessionFactory: this.deps.sessionFactory,
        emit: context.emit,
        onWait: (ms) =>
          context.emit("info", {
            text: `The provider is rate limiting ${model.modelId}; waiting ${Math.ceil(ms / 1000)} s before trying again.`,
          }),
        onUsage: (usage) => context.reportUsage(usageWithCost(model, usage)),
        signal: context.signal,
        checkBudget: () => context.assertBudget?.(model),
        recordCall: () => context.recordModelCall?.(model),
      });
    } catch (err: unknown) {
      const failed = modelStageOutcome(err, resolved);
      if (failed) return failed;
      throw err;
    }

    // The plan text is streamed as its own event, so the timeline can show what was planned
    // without re-reading the run (#256).
    context.emit("plan_ready", { plan });

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
