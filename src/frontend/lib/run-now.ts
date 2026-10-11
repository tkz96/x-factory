// src/frontend/lib/run-now.ts — What the run page's "now" header shows, read from the run and
// its real events (#262, spec #241 "Status → UI mapping"). The status map supplies the title and
// the sentence; this module adds only the facts the sentence points at: the plan, the diff, the
// pull request, and the failure with its recovery.

import { type DiffSummary, summarizeDiff } from "../../shared/diff-summary.js";
import type { Run, RunEvent } from "../../shared/types.js";
import { runStatusUi } from "./run-status-ui.js";

export interface RunNowFailure {
  message: string;
  recovery: string;
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

  return {
    title: ui.header,
    sentence: ui.now,
    plan,
    diff,
    pullRequestUrl: run.pullRequest?.url ?? null,
    failure: failureFor(run, events),
  };
}
