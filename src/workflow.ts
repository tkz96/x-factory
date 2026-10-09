// src/workflow.ts — The workflow module (#181), in-process and deep. It owns where a run goes:
// stage outcome → next run status and next stage, the resume target for each stage, the
// approve / restart / requeue routes, and the guards that decide whether those actions apply.
// Executors return only a StageOutcome; the worker and the run service ask this module what
// happens next. The FSM legality matrix stays in src/shared/run-status-policy.ts and is still
// enforced by RunRepository.transitionRun.

import { ConflictError } from "./errors.js";
import { canRunAction, type RunAction } from "./shared/run-status-policy.js";
import type { RunStatus, WorkflowStage } from "./shared/types.js";

/** Where a run goes next, and the stage whose job is enqueued for it. */
export interface Route {
  readonly to: RunStatus;
  readonly nextStage?: WorkflowStage;
}

/**
 * Stage outcome → route for a passed stage. `deliver` is absent on purpose: delivery runs as
 * the deliver command and finishes through finalizeDeliver, not through worker progression.
 */
export const PASSED_ROUTES: Readonly<Record<string, Route>> = {
  prepare: { to: "understanding", nextStage: "understand" },
  understand: { to: "awaiting_understanding_approval" },
  plan: { to: "awaiting_plan_approval" },
  execute: { to: "awaiting_review" },
  review: { to: "awaiting_review" },
};

/** A rejected stage (a review that did not approve) ends the run; it is never retried. */
export const REJECTED_RUN_STATUS: RunStatus = "failed";

/** A resume target: the status a run re-enters and the job stage that re-runs the work. */
export interface ResumeRoute {
  readonly to: RunStatus;
  readonly jobStage: WorkflowStage;
}

/**
 * The stage a run re-enters when resumed from recovery_required, keyed by the stage its last
 * attempt was in. `review` and `verify` are work inside `execute`, so they resume there.
 */
export const RESUME_ROUTES: Readonly<Record<string, ResumeRoute>> = {
  prepare: { to: "preparing", jobStage: "prepare" },
  understand: { to: "understanding", jobStage: "understand" },
  plan: { to: "planning", jobStage: "plan" },
  execute: { to: "executing", jobStage: "execute" },
  review: { to: "executing", jobStage: "execute" },
  verify: { to: "executing", jobStage: "execute" },
  implement: { to: "executing", jobStage: "execute" },
  deliver: { to: "ready_for_pr", jobStage: "deliver" },
};

const UNMAPPED_RESUME_ROUTE: ResumeRoute = {
  to: "executing",
  jobStage: "execute",
};

/** The resume target for the stage of a run's last attempt; a run with no attempt restarts at prepare. */
export function resumeRouteFor(lastStage: string | undefined): ResumeRoute {
  if (lastStage === undefined)
    return RESUME_ROUTES.prepare ?? UNMAPPED_RESUME_ROUTE;
  return RESUME_ROUTES[lastStage] ?? UNMAPPED_RESUME_ROUTE;
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
