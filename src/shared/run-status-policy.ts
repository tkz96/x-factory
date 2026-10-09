// src/shared/run-status-policy.ts — The single run-status policy shared by the
// server and the client (#170). It owns the transition matrix, the terminal,
// active, executable and stoppable sets, the actions allowed per status,
// status→stage for display, and labels. The contract remains
// docs/reference/state-machine-matrix.md; this module is its implementation.
// Only ownership of the policy moved here — behaviour is unchanged.

import type { RunStatus, WorkflowStage } from "./types.js";

/**
 * Permitted target states for each starting state (the legality matrix in
 * docs/reference/state-machine-matrix.md).
 */
export const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["preparing", "failed", "stopped"],
  preparing: ["understanding", "failed", "stopped", "recovery_required"],
  understanding: [
    "awaiting_understanding_approval",
    "planning",
    "failed",
    "stopped",
    "recovery_required",
  ],
  awaiting_understanding_approval: [
    "planning",
    "understanding",
    "failed",
    "stopped",
  ],
  planning: [
    "awaiting_plan_approval",
    "failed",
    "stopped",
    "recovery_required",
  ],
  awaiting_plan_approval: ["executing", "understanding", "failed", "stopped"],
  executing: ["awaiting_review", "failed", "stopped", "recovery_required"],
  awaiting_review: [
    "ready_for_pr",
    "planning",
    "understanding",
    "failed",
    "stopped",
    "recovery_required",
  ],
  ready_for_pr: ["pr_created", "failed", "stopped"],
  recovery_required: [
    "preparing",
    "understanding",
    "planning",
    "executing",
    "failed",
    "stopped",
  ],
  pr_created: [],
  failed: [],
  stopped: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses whose runs the worker may claim and execute stages for. */
export const EXECUTABLE_RUN_STATUSES = new Set<RunStatus>([
  "queued",
  "preparing",
  "understanding",
  "planning",
  "executing",
]);

/** Statuses a user may stop (POST /api/runs/:id/stop). */
export const STOPPABLE_RUN_STATUSES = new Set<RunStatus>([
  "queued",
  "preparing",
  "understanding",
  "awaiting_understanding_approval",
  "planning",
  "awaiting_plan_approval",
  "executing",
  "awaiting_review",
]);

/** Statuses from which the run can never transition again. */
export const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "pr_created",
  "failed",
  "stopped",
]);

/** Every non-terminal status — a run that has not reached an end state. */
export const ACTIVE_RUN_STATUSES = new Set<RunStatus>(
  (Object.keys(TRANSITIONS) as RunStatus[]).filter(
    (status) => !TERMINAL_RUN_STATUSES.has(status),
  ),
);

/** Terminal statuses where the run ended without a pull request. */
export const UNSUCCESSFUL_TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "failed",
  "stopped",
]);

/** Statuses at or past delivery: the run is ready for, or has, a pull request. */
export const DELIVERY_RUN_STATUSES = new Set<RunStatus>([
  "ready_for_pr",
  "pr_created",
]);

/** Statuses that show the human checkpoint / delivery section of a run. */
export const CHECKPOINT_RUN_STATUSES = new Set<RunStatus>([
  "awaiting_review",
  "ready_for_pr",
  "pr_created",
]);

/** Statuses where the run waits on a human and holds no worker-driven work. */
export const AWAITING_HUMAN_RUN_STATUSES = new Set<RunStatus>([
  "awaiting_understanding_approval",
  "awaiting_plan_approval",
  "awaiting_review",
  "ready_for_pr",
]);

/** Statuses that hold no live work: terminal runs plus `recovery_required`. */
export const NON_LIVE_RUN_STATUSES = new Set<RunStatus>([
  ...TERMINAL_RUN_STATUSES,
  "recovery_required",
]);

/**
 * User-triggered run actions guarded by the server (see `src/runs.ts` and
 * `src/http/runs-controller.ts`). `abort` is absent because the server maps it
 * straight onto `stop`'s guard.
 */
export type RunAction =
  | "abandon"
  | "approve"
  | "chat"
  | "deliver"
  | "requeue"
  | "restart"
  | "resume"
  | "stop";

/**
 * The actions the server's guards accept in each status.
 * `test/run-status-policy.test.ts` exercises the real guards and fails if
 * this table and the guards ever drift apart.
 */
export const ACTIONS_BY_STATUS: Record<RunStatus, readonly RunAction[]> = {
  queued: ["stop"],
  preparing: ["stop"],
  understanding: ["stop"],
  awaiting_understanding_approval: ["approve", "restart", "chat", "stop"],
  planning: ["stop"],
  awaiting_plan_approval: ["approve", "restart", "chat", "stop"],
  executing: ["stop"],
  awaiting_review: ["approve", "requeue", "chat", "stop"],
  ready_for_pr: ["deliver"],
  pr_created: [],
  recovery_required: ["resume", "abandon"],
  failed: [],
  stopped: [],
};

export function allowedActionsFor(status: RunStatus): readonly RunAction[] {
  return ACTIONS_BY_STATUS[status] ?? [];
}

export function canRunAction(status: RunStatus, action: RunAction): boolean {
  return allowedActionsFor(status).includes(action);
}

/**
 * The canonical workflow stage to display for each status, or null when the
 * status maps to no stage (see "State to Stage/Job Mapping" in the matrix).
 */
export const STATUS_TO_STAGE: Record<RunStatus, WorkflowStage | null> = {
  queued: "prepare",
  preparing: "prepare",
  understanding: "understand",
  awaiting_understanding_approval: "understand",
  planning: "plan",
  awaiting_plan_approval: "plan",
  executing: "execute",
  awaiting_review: "review",
  ready_for_pr: "deliver",
  pr_created: "deliver",
  recovery_required: null,
  failed: null,
  stopped: null,
};

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  queued: "queued",
  preparing: "preparing",
  understanding: "understanding",
  awaiting_understanding_approval: "awaiting understanding approval",
  planning: "planning",
  awaiting_plan_approval: "awaiting plan approval",
  executing: "executing",
  awaiting_review: "awaiting review",
  ready_for_pr: "ready for pr",
  pr_created: "pr created",
  recovery_required: "recovery required",
  failed: "failed",
  stopped: "stopped",
};

export function runStatusLabel(status: RunStatus): string {
  return RUN_STATUS_LABELS[status] ?? status;
}
