import { generateDefaultPlan } from "../prompts.js";
import type { StageContext, StageExecutor, StageOutcome } from "./types.js";

export class PlanExecutor implements StageExecutor {
  readonly stage = "plan";

  async execute(context: StageContext): Promise<StageOutcome> {
    const { run } = context;

    context.emit("info", { text: "Generating execution plan…" });

    const plan =
      run.plan && run.plan.trim().length > 0
        ? run.plan
        : generateDefaultPlan(run.ticket);

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
