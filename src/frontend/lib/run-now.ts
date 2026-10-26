// src/frontend/lib/run-now.ts — What the run page's "now" header shows, read from the run and
// its real events (#262, spec #241 "Status → UI mapping"). The status map supplies the title and
// the sentence; this module adds only the facts the sentence points at: the plan, the diff, the
// pull request, and the failure with its recovery.

import { type DiffSummary, summarizeDiff } from "../../shared/diff-summary.js";
import type { PullRequestOutcome, Run, RunEvent } from "../../shared/types.js";
import { STATUS_COPY } from "../components/feedback/copy-map.js";
import { runStatusUi } from "./run-status-ui.js";

export interface RunNowFailure {
  message: string;
  recovery: string;
}

/** The title and sentence while the run's job is waiting for a worker (Finding 9). */
export const WAITING_FOR_WORKER_TITLE = "Waiting for the worker";
const WAITING_FOR_WORKER_SENTENCE =
  "The step is ready, but no worker has picked it up yet. It starts as soon as a worker is free.";

/**
 * True when a stage label would claim work is under way that no worker is doing. A queued run
 * is left alone: its own status already says it waits for a slot.
 */
export function isWaitingForWorker(run: Run): boolean {
  return run.waitingForWorker === true && run.status !== "queued";
}

export interface RunNow {
  /** The status map's plain title, e.g. "Review the plan". */
  title: string;
  /** The status map's one-sentence "now" line. */
  sentence: string;
  /** The plan awaiting approval, or null on any other status. */
  plan: string | null;
  /** The change summary once changes exist, or null. */
  diff: DiffSummary | null;
  pullRequestUrl: string | null;
  pullRequestOutcome: PullRequestOutcome | null;
  failure: RunNowFailure | null;
}

/** The newest event of one type, read as the payload shape the caller expects. */
function latest<T>(events: readonly RunEvent[], type: string): T | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event?.type === type) return event.payload as T;
  }
  return null;
}

function failureFor(
  run: Run,
  events: readonly RunEvent[],
): RunNowFailure | null {
  if (run.status === "failed") {
    const payload = latest<{
      failure?: RunNowFailure;
      text?: string;
    }>(events, "status");
    if (payload?.failure) {
      return {
        message: payload.failure.message,
        recovery: payload.failure.recovery,
      };
    }
    return {
      message: "This run failed and can't continue.",
      recovery: "Start a new run for this ticket to try again.",
    };
  }
  if (run.status === "review_retry_required") {
    // The last model error is the status event's reason; the code is kept.
    const payload = latest<{ reason?: string }>(events, "status");
    return {
      message:
        payload?.reason ??
        "The reviewer model failed three times in a row, so the review did not finish.",
      recovery:
        "Retry Review runs only the review again; the code is not changed. Abandon Run ends the run and keeps its branch.",
    };
  }
  if (run.status === "recovery_required") {
    const payload = latest<{
      reason?: string;
      text?: string;
    }>(events, "status");
    return {
      message:
        payload?.reason ??
        payload?.text ??
        "The run stopped unexpectedly before it finished.",
      recovery: "Resume Run carries on from the last checkpoint.",
    };
  }
  return null;
}

/** The now header for one run, from its status map entry and its real events. */
export function runNow(run: Run, events: readonly RunEvent[]): RunNow {
  const ui = runStatusUi(run.status);

  // The plan shows at the plan checkpoint: the step is Plan and the status can approve.
  let plan: string | null = null;
  if (ui.step === "Plan" && ui.actions.some((a) => a.action === "approve")) {
    plan =
      latest<{ plan: string }>(events, "plan_ready")?.plan ?? run.plan ?? null;
  }

  // Changes exist from review onwards: the review and delivery steps.
  let diff: DiffSummary | null = null;
  if (ui.step === "Review" || ui.step === "Deliver") {
    const summary = summarizeDiff(run.diff);
    diff = summary.files.length > 0 ? summary : null;
  }

  const mergedEvent = latest<{
    url: string;
    mergedAt: string;
    mergedBy?: string;
  }>(events, "pr_merged");
  const closedEvent = latest<{ url: string; closedAt: string }>(
    events,
    "pr_closed",
  );

  const outcome: PullRequestOutcome | null =
    run.pullRequestOutcome ??
    (mergedEvent
      ? {
          status: "merged",
          state: "merged",
          url: mergedEvent.url,
          mergedAt: mergedEvent.mergedAt,
          mergedBy: mergedEvent.mergedBy,
        }
      : closedEvent
        ? {
            status: "closed",
            state: "closed",
            url: closedEvent.url,
            closedAt: closedEvent.closedAt,
          }
        : null);

  let title = ui.header;
  let sentence = ui.now;
  if (isWaitingForWorker(run)) {
    title = WAITING_FOR_WORKER_TITLE;
    sentence = WAITING_FOR_WORKER_SENTENCE;
  }
  if (outcome?.status === "merged") {
    title = STATUS_COPY.prMerged;
    sentence = "The pull request was merged.";
  } else if (outcome?.status === "closed") {
    title = STATUS_COPY.prClosedUnmerged;
    sentence = "The pull request was closed without merging.";
  }

  return {
    title,
    sentence,
    plan,
    diff,
    pullRequestUrl: run.pullRequest?.url ?? outcome?.url ?? null,
    pullRequestOutcome: outcome,
    failure: failureFor(run, events),
  };
}
