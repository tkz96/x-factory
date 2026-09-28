import type { Ticket } from "../shared/types.js";
import type { StageContext, StageExecutor, StageResult } from "./types.js";

export function generateDefaultPlan(ticket: Ticket): string {
  const criteria =
    ticket.acceptanceCriteria && ticket.acceptanceCriteria.length > 0
      ? ticket.acceptanceCriteria
      : ["Implement required functionality according to ticket specifications"];

  let plan = `# Execution Plan for #${ticket.id}: ${ticket.title}\n\n`;
  plan += `## Task 1: Setup & Tests\n`;
  plan += `- [ ] Create test fixtures and failing test cases for acceptance criteria\n`;
  plan += `- [ ] Run test suite to verify failing (RED) state\n\n`;

  plan += `## Task 2: Core Implementation\n`;
  for (const ac of criteria) {
    plan += `- [ ] Implement ${ac}\n`;
  }
  plan += `- [ ] Run test suite to verify passing (GREEN) state\n\n`;

  plan += `## Task 3: Quality Verification & Refactor\n`;
  plan += `- [ ] Refactor implementation for maintainability and clarity\n`;
  plan += `- [ ] Run typecheck and lint to ensure clean build\n`;
  plan += `- [ ] Ensure zero test regressions\n`;

  return plan.trim();
}

export class PlanExecutor implements StageExecutor {
  readonly stage = "plan";

  async execute(context: StageContext): Promise<StageResult> {
    const { run } = context;

    context.eventRepo.appendEvent(run.id, "info", {
      text: "Generating execution plan…",
    });

    const plan =
      run.plan && run.plan.trim().length > 0
        ? run.plan
        : generateDefaultPlan(run.ticket);

    context.runRepo.update(run.id, {
      plan,
      expectedRevision: run.revision,
    });

    context.eventRepo.appendEvent(run.id, "stage_evidence", {
      stage: "plan",
      evidence: `Generated execution plan with tasks for #${run.ticket?.id || run.id}.`,
    });

    return {
      status: "success",
      nextStage: undefined,
      nextRunStatus: "awaiting_plan_approval",
      output: {
        planReady: true,
      },
    };
  }
}
