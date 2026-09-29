// src/state-machine.ts — Finite state machine transitions and transition guards.

import type { RunStatus } from "./types.js";

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

export const EXECUTABLE_RUN_STATUSES = new Set<RunStatus>([
  "queued",
  "preparing",
  "understanding",
  "planning",
  "executing",
]);

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

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "pr_created",
  "failed",
  "stopped",
]);
