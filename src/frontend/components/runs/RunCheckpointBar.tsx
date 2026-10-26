// src/frontend/components/runs/RunCheckpointBar.tsx — The checkpoint bar above the message box (#262).
// It offers exactly the status map's run actions for the run's status (Stop Run lives in the
// toolbar menu and chat has its own box), plus Start New Run on a terminal run. While an action is
// in flight its label says so and its siblings are disabled.

import "./RunCheckpointBar.css";

import type { RunStatus } from "../../../shared/types.js";
import { runStatusUi } from "../../lib/run-status-ui.js";
import { Button } from "../ui/Button.js";

/** What the bar can ask for. Request Changes is `restart` or `requeue`, whichever the status allows. */
export type CheckpointAction =
  | "approve"
  | "restart"
  | "requeue"
  | "deliver"
  | "resume"
  | "retry-review"
  | "abandon"
  | "start-new-run"
  | "confirm-rework";

const BAR_ACTION_FOR: Record<string, CheckpointAction> = {
  approve: "approve",
  restart: "restart",
  requeue: "requeue",
  deliver: "deliver",
  resume: "resume",
  retry_review: "retry-review",
  abandon: "abandon",
};

/** The label shown while an action is in flight (verb-first, sentence case). */
const PENDING_LABEL: Record<CheckpointAction, string> = {
  approve: "Approving…",
  restart: "Requesting Changes…",
  requeue: "Requesting Changes…",
  deliver: "Creating Pull Request…",
  resume: "Resuming…",
  "retry-review": "Retrying Review…",
  abandon: "Abandoning…",
  "start-new-run": "Starting…",
  "confirm-rework": "Requesting Changes…",
};

const VARIANT: Record<
  CheckpointAction,
  "primary" | "secondary" | "danger" | "quiet"
> = {
  approve: "primary",
  restart: "secondary",
  requeue: "secondary",
  deliver: "primary",
  resume: "primary",
  "retry-review": "primary",
  abandon: "danger",
  "start-new-run": "secondary",
  "confirm-rework": "secondary",
};

export interface CheckpointBarEntry {
  action: CheckpointAction;
  label: string;
}

/** The bar's buttons for a status, from the one status map. */
export function checkpointBarEntries(
  status: RunStatus,
  reworkReady = false,
): CheckpointBarEntry[] {
  const ui = runStatusUi(status);
  const entries: CheckpointBarEntry[] = [];
  for (const { action, label } of ui.actions) {
    const bar = BAR_ACTION_FOR[action];
    if (!bar || !label) continue;
    // Once the reader has written the rework, the bar offers to confirm it instead.
    if (reworkReady && bar === "requeue") {
      entries.push({ action: "confirm-rework", label: "Confirm Rework" });
    } else {
      entries.push({ action: bar, label });
    }
  }
  if (ui.ticketCommand) {
    entries.push({ action: "start-new-run", label: ui.ticketCommand });
  }
  return entries;
}

export interface RunCheckpointBarProps {
  status: RunStatus;
  /** The action in flight, if any. */
  pending: CheckpointAction | null;
  /** True when the last action raced with the run and lost. */
  conflict: boolean;
  /** True once the reader has written the rework notes, so the bar confirms them. */
  reworkReady?: boolean;
  onAction: (action: CheckpointAction) => void;
}

export function RunCheckpointBar({
  status,
  pending,
  conflict,
  reworkReady = false,
  onAction,
}: RunCheckpointBarProps) {
  const entries = checkpointBarEntries(status, reworkReady);
  if (entries.length === 0 && !conflict) return null;
  // A decision card has exactly one primary action (DESIGN.md §7, "Interaction
  // patterns"). A status that offers only secondary actions promotes its first.
  const hasPrimary = entries.some(
    ({ action }) => VARIANT[action] === "primary",
  );
  const primaryAction = entries[0]?.action;
  const isPrimary = (action: CheckpointAction) =>
    VARIANT[action] === "primary" || (!hasPrimary && action === primaryAction);

  return (
    <section className="run-checkpoint-bar" aria-label="Checkpoint">
      {conflict && (
        <p className="run-checkpoint-conflict text-callout" role="alert">
          This run already moved on. Showing the latest.
        </p>
      )}
      {entries.length > 0 && (
        <div className="run-checkpoint-actions">
          {entries.map(({ action, label }) => {
            const isPending =
              pending === action ||
              (action === "confirm-rework" && pending === "requeue");
            return (
              <Button
                key={action}
                variant={isPrimary(action) ? "primary" : VARIANT[action]}
                size="sm"
                // Mod+Enter presses only a real decision. A promoted action on a
                // finished run (Start New Run) looks primary but is never one key away.
                data-primary-action={
                  VARIANT[action] === "primary" ? "" : undefined
                }
                isDisabled={pending !== null}
                onPress={() => onAction(action)}
              >
                {isPending ? PENDING_LABEL[action] : label}
              </Button>
            );
          })}
        </div>
      )}
    </section>
  );
}
