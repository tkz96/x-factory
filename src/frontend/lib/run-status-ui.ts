// The one client mapping from RunStatus to everything the UI shows for it
// (#253, spec #241 "Status → UI mapping"). Which actions are allowed comes
// only from the shared run-status policy; this module adds wording on top and
// never a second workflow.

import {
  allowedActionsFor,
  type RunAction,
  TERMINAL_RUN_STATUSES,
} from "../../shared/run-status-policy.js";
import type { RunStatus } from "../../shared/types.js";

export type RunStep =
  | "Prepare"
  | "Understand"
  | "Plan"
  | "Code"
  | "Review"
  | "Deliver";

export type RunFilter = "Needs you" | "Running" | "Done";

export interface RunActionUi {
  /** The shared policy action this button triggers. */
  action: RunAction;
  /** On-screen button label, or null for actions with no button (chat). */
  label: string | null;
}

export interface RunNotificationUi {
  group: "Needs you" | "Finished";
  text: string;
}

export interface RunStatusUi {
  label: string;
  /** The step highlighted for this status; null keeps the last step. */
  step: RunStep | null;
  filter: RunFilter;
  now: string;
  /** The run chat header title: what the run is doing, in plain words. */
  header: string;
  /** The run chat input placeholder while the run is in this status. */
  placeholder: string;
  actions: readonly RunActionUi[];
  /** Offered on terminal runs only; not a policy action. */
  ticketCommand: "Start New Run" | null;
  notification: RunNotificationUi | null;
}

const ACTION_LABELS: Record<RunAction, string | null> = {
  abandon: "Abandon Run",
  approve: "Approve",
  chat: null,
  deliver: "Create Pull Request",
  requeue: "Request Changes",
  restart: "Request Changes",
  resume: "Resume Run",
  stop: "Stop Run",
};

type StatusRow = Omit<RunStatusUi, "actions" | "ticketCommand"> & {
  approveLabel?: string;
};

const ROWS: Record<RunStatus, StatusRow> = {
  queued: {
    label: "Waiting to start",
    step: "Prepare",
    filter: "Running",
    now: "Waiting for a free slot. It starts as soon as the run ahead of it finishes.",
    header: "Waiting to start",
    placeholder: "This run is queued behind other work.",
    notification: null,
  },
  preparing: {
    label: "Preparing",
    step: "Prepare",
    filter: "Running",
    now: "Setting up the branch and the workspace.",
    header: "Preparing the workspace",
    placeholder: "Setting up the branch and workspace…",
    notification: null,
  },
  understanding: {
    label: "Reading the ticket",
    step: "Understand",
    filter: "Running",
    now: "Reading the ticket and the code it touches.",
    header: "Reading the ticket",
    placeholder: "Reading the ticket…",
    notification: null,
  },
  awaiting_understanding_approval: {
    label: "Check understanding",
    step: "Understand",
    filter: "Needs you",
    now: "Check what it understood, then approve it or ask for changes.",
    header: "Check the understanding",
    placeholder: "Ask about what it found, or challenge an assumption…",
    approveLabel: "Approve Understanding",
    notification: { group: "Needs you", text: "Understanding ready" },
  },
  planning: {
    label: "Planning",
    step: "Plan",
    filter: "Running",
    now: "Drafting the plan from the ticket.",
    header: "Planning",
    placeholder: "Drafting the plan…",
    notification: null,
  },
  awaiting_plan_approval: {
    label: "Review the plan",
    step: "Plan",
    filter: "Needs you",
    now: "Read the plan, then approve it or request changes.",
    header: "Review the plan",
    placeholder: "Ask about the plan, or request changes…",
    approveLabel: "Approve Plan",
    notification: { group: "Needs you", text: "Plan ready" },
  },
  executing: {
    label: "Writing code",
    step: "Code",
    filter: "Running",
    now: "Writing the code changes for the plan.",
    header: "Writing code",
    placeholder: "Writing the code changes…",
    notification: null,
  },
  awaiting_review: {
    label: "Review the changes",
    step: "Review",
    filter: "Needs you",
    now: "Read the changes, then approve them or request changes.",
    header: "Review the changes",
    placeholder: "Ask about the changes, or request changes…",
    approveLabel: "Approve Changes",
    notification: { group: "Needs you", text: "Changes ready" },
  },
  ready_for_pr: {
    label: "Ready for a pull request",
    step: "Deliver",
    filter: "Needs you",
    now: "The change is ready. Create a pull request to deliver it.",
    header: "Ready for a pull request",
    placeholder: "Open the pull request when you're ready.",
    notification: { group: "Needs you", text: "Ready for a pull request" },
  },
  pr_created: {
    label: "Pull request opened",
    step: "Deliver",
    filter: "Done",
    now: "The pull request is open.",
    header: "Pull request opened",
    placeholder: "The pull request is open.",
    notification: { group: "Finished", text: "Pull request opened" },
  },
  recovery_required: {
    label: "Needs recovery",
    step: null,
    filter: "Needs you",
    now: "The run stopped before it finished.",
    header: "Needs recovery",
    placeholder: "Resume the run to carry on.",
    notification: { group: "Needs you", text: "Needs recovery" },
  },
  failed: {
    label: "Failed",
    step: null,
    filter: "Done",
    now: "This run failed and can't continue.",
    header: "Failed",
    placeholder: "This run failed and can't continue.",
    notification: { group: "Finished", text: "Run failed" },
  },
  stopped: {
    label: "Stopped",
    step: null,
    filter: "Done",
    now: "This run was stopped and can't continue.",
    header: "Stopped",
    placeholder: "This run was stopped and can't continue.",
    notification: { group: "Finished", text: "Run stopped" },
  },
};

function actionsFor(status: RunStatus): readonly RunActionUi[] {
  const approveLabel = ROWS[status].approveLabel ?? ACTION_LABELS.approve;
  return allowedActionsFor(status).map((action) => ({
    action,
    label: action === "approve" ? approveLabel : ACTION_LABELS[action],
  }));
}

export const RUN_STATUS_UI: Record<RunStatus, RunStatusUi> = Object.fromEntries(
  (Object.keys(ROWS) as RunStatus[]).map((status) => {
    const { approveLabel: _unused, ...row } = ROWS[status];
    return [
      status,
      {
        ...row,
        actions: actionsFor(status),
        ticketCommand: TERMINAL_RUN_STATUSES.has(status)
          ? "Start New Run"
          : null,
      },
    ];
  }),
) as Record<RunStatus, RunStatusUi>;

/** The UI mapping for a status; unknown values never leak a raw string. */
export function runStatusUi(status: RunStatus): RunStatusUi {
  return (
    RUN_STATUS_UI[status] ?? {
      label: "Unknown status",
      step: null,
      filter: "Running",
      now: "",
      header: "Unknown status",
      placeholder: "",
      actions: [],
      ticketCommand: null,
      notification: null,
    }
  );
}

/** The on-screen label for a status. */
export function runStatusText(status: RunStatus): string {
  return runStatusUi(status).label;
}

/** Statuses in the "Needs you" filter group. */
export const NEEDS_YOU_STATUSES: ReadonlySet<RunStatus> = new Set(
  (Object.keys(RUN_STATUS_UI) as RunStatus[]).filter(
    (s) => RUN_STATUS_UI[s].filter === "Needs you",
  ),
);
