// src/frontend/components/runs/RunTerminalCard.tsx — The calm card of a finished run (spec #312, "Decision
// card and terminal states"): the failure with its cause, who stopped the run, or the pull request's
// outcome. It is the default card, never the orange decision style, because nothing waits on the reader.

import type { Run } from "../../../shared/types.js";
import { formatRelativeTime } from "../../lib/format-timestamp.js";
import { FAILURE_CATEGORY_LABEL, type RunNow } from "../../lib/run-now.js";
import { STATUS_COPY } from "../feedback/copy-map.js";
import { Card } from "../ui/Card.js";
import { type CheckpointAction, RunCheckpointBar } from "./RunCheckpointBar.js";

interface RunTerminalCardProps {
  run: Run;
  facts: RunNow;
  /** The label of the stage the run failed in, or null when it is not known. */
  failedStage: string | null;
  pending: CheckpointAction | null;
  conflict: boolean;
  onAction: (action: CheckpointAction) => void;
}

function Failure({
  facts,
  failedStage,
}: {
  facts: RunNow;
  failedStage: string | null;
}) {
  const failure = facts.failure;
  if (!failure) return null;
  const category = FAILURE_CATEGORY_LABEL[failure.category ?? "unknown"];
  return (
    <>
      <h2 className="run-terminal-title text-title-3">{category}</h2>
      {failedStage && (
        <p className="run-terminal-meta text-footnote">{`Failed in ${failedStage}`}</p>
      )}
      <p className="run-terminal-message text-body">{failure.message}</p>
      <p className="run-terminal-recovery text-callout">{failure.recovery}</p>
    </>
  );
}

function Stopped({ facts }: { facts: RunNow }) {
  return (
    <>
      <h2 className="run-terminal-title text-title-3">
        {STATUS_COPY.stageStopped}
      </h2>
      <p className="run-terminal-meta text-callout">
        Stopped by you
        {facts.stoppedAt && (
          <>
            {" · "}
            <time dateTime={facts.stoppedAt}>
              {formatRelativeTime(facts.stoppedAt, Date.now())}
            </time>
          </>
        )}
      </p>
    </>
  );
}

function PullRequest({ facts }: { facts: RunNow }) {
  const outcome = facts.pullRequestOutcome;
  const title =
    outcome?.status === "merged"
      ? STATUS_COPY.prMerged
      : outcome?.status === "closed"
        ? STATUS_COPY.prClosedUnmerged
        : "Pull request open";
  const at =
    outcome?.status === "merged"
      ? outcome.mergedAt
      : outcome?.status === "closed"
        ? outcome.closedAt
        : undefined;
  return (
    <>
      <h2 className="run-terminal-title text-title-3">{title}</h2>
      {at && (
        <p className="run-terminal-meta text-callout">
          <time dateTime={at}>{formatRelativeTime(at, Date.now())}</time>
        </p>
      )}
      {facts.pullRequestUrl && (
        // An external link stays a link, dressed as the secondary button it reads as.
        <a
          className="run-terminal-link ui-button ui-button--secondary ui-button--sm"
          href={facts.pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Pull Request ↗
        </a>
      )}
    </>
  );
}

export function RunTerminalCard({
  run,
  facts,
  failedStage,
  pending,
  conflict,
  onAction,
}: RunTerminalCardProps) {
  return (
    <Card variant="default" className="run-decision run-decision--terminal">
      {run.status === "failed" && (
        <Failure facts={facts} failedStage={failedStage} />
      )}
      {run.status === "stopped" && <Stopped facts={facts} />}
      {run.status === "pr_created" && <PullRequest facts={facts} />}
      <RunCheckpointBar
        status={run.status}
        pending={pending}
        conflict={conflict}
        onAction={onAction}
      />
    </Card>
  );
}
