// src/frontend/components/runs/RunDecisionCard.tsx — The decision card: what the run asks of the reader,
// with its checkpoint actions. It shows while the run waits on the reader, while an action is on offer,
// or when there is a failure or a pull request to read.

import type { Run } from "../../../shared/types.js";
import type { RunNow } from "../../lib/run-now.js";
import { NEEDS_YOU_STATUSES } from "../../lib/run-status-ui.js";
import {
  type CheckpointAction,
  checkpointBarEntries,
  RunCheckpointBar,
} from "./RunCheckpointBar.js";
import { RunNowHeader } from "./RunNowHeader.js";

interface RunDecisionCardProps {
  run: Run;
  /** The run's facts as the run-now line reads them. */
  facts: RunNow;
  pending: CheckpointAction | null;
  conflict: boolean;
  reworkReady: boolean;
  onAction: (action: CheckpointAction) => void;
}

/** Whether the decision card has anything to show for the run. */
export function decisionShows(
  run: Run,
  facts: RunNow,
  conflict: boolean,
  reworkReady: boolean,
): boolean {
  if (NEEDS_YOU_STATUSES.has(run.status) || conflict) return true;
  if (checkpointBarEntries(run.status, reworkReady).length > 0) return true;
  return facts.failure !== null || facts.pullRequestUrl !== null;
}

export function RunDecisionCard({
  run,
  facts,
  pending,
  conflict,
  reworkReady,
  onAction,
}: RunDecisionCardProps) {
  return (
    <div className="run-decision">
      <RunNowHeader run={run} now={facts} />
      <RunCheckpointBar
        status={run.status}
        pending={pending}
        conflict={conflict}
        reworkReady={reworkReady}
        onAction={onAction}
      />
    </div>
  );
}
