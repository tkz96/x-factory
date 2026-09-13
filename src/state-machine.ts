// src/state-machine.ts — Finite state machine transitions and transition guards.

import type { RunStatus } from "./types.js";

export const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  preparing: ["understanding", "failed"],
  understanding: ["implementing", "failed", "stopped"],
  implementing: ["verifying", "failed", "stopped"],
  verifying: ["reviewing", "implementing", "failed"],
  reviewing: ["ready_for_pr", "failed"],
  ready_for_pr: ["pr_created", "failed"],
  pr_created: [],
  failed: [],
  stopped: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}
