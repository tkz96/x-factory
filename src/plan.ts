// src/plan.ts — Plan stage: the Builder's implementation plan (#282). The Builder
// reads the repository with read-only tools and answers with the plan itself; the
// plan it names files and tests in is what the run shows for approval. A plan that
// names no file, or no test, fails the stage instead of being replaced by a
// template.

import {
  ModelOutputError,
  type ReadOnlyStageRun,
  runReadOnlyStage,
} from "./agent-stage.js";
import { buildPlanPrompt } from "./prompts.js";
import type { ImplementationContext, Project, Ticket } from "./types.js";

/** A path-like token: `src/plan.ts`, `test/x.test.ts`, `package.json`. */
const FILE_TOKEN = /(?:[\w.@-]+\/)+[\w.@-]+|[\w@-]+\.[a-z]{2,6}\b/i;

const TEST_TOKEN = /\btests?\b/i;

/**
 * Keeps the first `# Execution Plan` heading and drops any repeat. The plan prompt
 * asks for that heading, and the model may write it again after the draft's own.
 */
function keepFirstExecutionPlanHeading(plan: string): string {
  let seen = false;
  return plan
    .split("\n")
    .filter((line) => {
      if (!/^# Execution Plan\b/.test(line)) return true;
      if (seen) return false;
      seen = true;
      return true;
    })
    .join("\n");
}

/**
 * The Builder's plan, cleaned of the fences and preamble a model may add (#282).
 * Throws `ModelOutputError` when the answer names no file or no test: that is an
 * honest stage failure, not a plan a run should execute.
 */
export function parsePlanOutput(output: string): string {
  const fenced = output.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i);
  const raw = (fenced?.[1] ?? output).trim();
  const heading = raw.search(/^#{1,3}\s+\S/m);
  const plan = keepFirstExecutionPlanHeading(
    (heading > 0 ? raw.slice(heading) : raw).trim(),
  ).trim();
  if (!plan) {
    throw new ModelOutputError("The Builder's plan was empty.");
  }
  if (!FILE_TOKEN.test(plan)) {
    throw new ModelOutputError("The Builder's plan named no files.");
  }
  if (!TEST_TOKEN.test(plan)) {
    throw new ModelOutputError("The Builder's plan named no tests.");
  }
  return plan;
}

/** What the Plan stage runs with: the ticket, the run's draft, and the model (#282). */
export interface PlanRun extends ReadOnlyStageRun {
  ticket: Ticket;
  project: Project;
  /** The plan the run already has: the operator's draft, or the last plan plus feedback. */
  draft?: string | undefined;
  /** What the Understand stage learned, when the run has it. */
  understanding?: ImplementationContext | null | undefined;
}

/**
 * Ask the Builder for the plan of this run (#282). The plan is the Builder's own,
 * written against the repository with read-only tools; the run's draft plan, when
 * it has one, is context it must keep the intent of, and the reviewer's feedback
 * inside it is what a requeue asks to address.
 */
export async function planRun(run: PlanRun): Promise<string> {
  const output = await runReadOnlyStage(
    run,
    buildPlanPrompt({
      ticket: run.ticket,
      project: run.project,
      draft: run.draft,
      understanding: run.understanding,
    }),
  );
  return parsePlanOutput(output);
}
