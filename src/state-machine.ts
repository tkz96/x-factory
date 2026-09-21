// src/state-machine.ts — Finite state machine transitions and transition guards.

import type { RunStatus } from "./types.js";

export const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  queued: ["preparing", "failed", "stopped"],
  preparing: ["understanding", "failed", "stopped", "recovery_required"],
  understanding: ["implementing", "failed", "stopped", "recovery_required"],
  implementing: ["verifying", "failed", "stopped", "recovery_required"],
  verifying: [
    "reviewing",
    "implementing",
    "failed",
    "stopped",
    "recovery_required",
  ],
  reviewing: ["ready_for_pr", "failed", "stopped", "recovery_required"],
  ready_for_pr: ["pr_created", "failed", "stopped"],
  recovery_required: [
    "preparing",
    "understanding",
    "implementing",
    "verifying",
    "reviewing",
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
  "implementing",
  "verifying",
  "reviewing",
]);

export const STOPPABLE_RUN_STATUSES = new Set<RunStatus>([
  "queued",
  "preparing",
  "understanding",
  "implementing",
  "verifying",
  "reviewing",
]);

export const TERMINAL_RUN_STATUSES = new Set<RunStatus>([
  "pr_created",
  "failed",
  "stopped",
]);
