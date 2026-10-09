// src/workflow.ts — The workflow module (#181), in-process and deep. It owns where a run goes:
// stage outcome → next run status and next stage, the resume target for each stage, the
// approve / restart / requeue routes, and the guards that decide whether those actions apply.
// Executors return only a StageOutcome; the worker and the run service ask this module what
// happens next. The FSM legality matrix stays in src/shared/run-status-policy.ts and is still
// enforced by RunRepository.transitionRun.

import { ConflictError } from "./errors.js";
import { canRunAction, type RunAction } from "./shared/run-status-policy.js";
import type { RunStatus, WorkflowStage } from "./shared/types.js";

/** Every stage a job or stage attempt can name. Routing tables are keyed by it. */
export const WORKFLOW_STAGES: readonly WorkflowStage[] = [
  "prepare",
  "understand",
  "plan",
  "execute",
  "review",
  "deliver",
];

export function isWorkflowStage(value: string): value is WorkflowStage {
  return (WORKFLOW_STAGES as readonly string[]).includes(value);
}

/** Where a run goes next, and the stage whose job is enqueued for it. */
export interface Route {
  readonly to: RunStatus;
  readonly nextStage?: WorkflowStage;
}

/**
 * Stage outcome → route for a passed stage. `deliver` is null on purpose: delivery runs as
 * the deliver command and finishes through finalizeDeliver, not through worker progression.
 */
export const PASSED_ROUTES: Readonly<Record<WorkflowStage, Route | null>> = {
  prepare: { to: "understanding", nextStage: "understand" },
  understand: { to: "awaiting_understanding_approval" },
  plan: { to: "awaiting_plan_approval" },
  execute: { to: "awaiting_review" },
  review: { to: "awaiting_review" },
  deliver: null,
};

/** A rejected stage (a review that did not approve) ends the run; it is never retried. */
export const REJECTED_RUN_STATUS: RunStatus = "failed";

/** A resume target: the status a run re-enters and the work that re-runs it. */
export interface ResumeRoute {
  readonly to: RunStatus;
  /** Job stage enqueued to re-run the interrupted work. */
  readonly jobStage?: WorkflowStage;
  /** Run command enqueued instead of a job (delivery runs as the deliver command). */
  readonly command?: "deliver";
}

/**
 * The stage a run re-enters when resumed from recovery_required, keyed by the stage its last
 * attempt was in. `review` is work inside `execute`, so it resumes there.
 */
export const RESUME_ROUTES: Readonly<Record<WorkflowStage, ResumeRoute>> = {
  prepare: { to: "preparing", jobStage: "prepare" },
  understand: { to: "understanding", jobStage: "understand" },
  plan: { to: "planning", jobStage: "plan" },
  execute: { to: "executing", jobStage: "execute" },
  review: { to: "executing", jobStage: "execute" },
  deliver: { to: "ready_for_pr", command: "deliver" },
};

/**
 * The resume target for the stage of a run's last attempt. A run with no attempt restarts at
 * prepare. A recorded stage with no route is refused, not guessed at.
 */
export function resumeRouteFor(lastStage: string | undefined): ResumeRoute {
  if (lastStage === undefined) return RESUME_ROUTES.prepare;
  if (!isWorkflowStage(lastStage)) {
    throw new ConflictError(
      `Cannot resume: no resume route for stage "${lastStage}".`,
    );
  }
  return RESUME_ROUTES[lastStage];
}

/** Where approving a run moves it, keyed by the gate it waits at. */
export const APPROVE_ROUTES: Partial<
  Record<RunStatus, Route & { text: string }>
> = {
  awaiting_understanding_approval: {
    to: "planning",
    nextStage: "plan",
    text: "Understanding approved, starting planning.",
  },
  awaiting_plan_approval: {
    to: "executing",
    nextStage: "execute",
    text: "Plan approved, moving to execution.",
  },
  awaiting_review: {
    to: "ready_for_pr",
    text: "Review approved, ready for Pull Request.",
  },
};

/** Restart sends a run back to understanding from any status that allows it. */
export const RESTART_ROUTE = {
  to: "understanding",
  nextStage: "understand",
  text: "Restarting plan context...",
} as const satisfies Route & { text: string };

/** Requeue sends a run back to planning with feedback from any status that allows it. */
export const REQUEUE_ROUTE = {
  to: "planning",
  nextStage: "plan",
  text: "Requeueing run for fresh plan...",
} as const satisfies Route & { text: string };

/**
 * The typed conflict for an action the run's status does not allow. The messages are part of
 * the HTTP contract (409 bodies), so they are kept verbatim.
 */
export function assertRunAction(status: RunStatus, action: RunAction): void {
  if (canRunAction(status, action)) return;
  if (action === "resume" || action === "abandon") {
    throw new ConflictError(
      `Cannot ${action} run in status "${status}". Run must be in "recovery_required".`,
    );
  }
  throw new ConflictError(`Cannot ${action} in status "${status}".`);
}
