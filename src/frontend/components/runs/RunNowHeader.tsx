// src/frontend/components/runs/RunNowHeader.tsx — The run page's "now" header (#262, spec #241).
// It says what the run is doing or waiting for, in one sentence, with the one fact that sentence
// points at: the plan awaiting approval, the change summary, the pull request, or the failure
// and its recovery.

import "./RunNowHeader.css";

import type { Run } from "../../../shared/types.js";
import { formatRelativeTime } from "../../lib/format-timestamp.js";
import type { RunNow } from "../../lib/run-now.js";
import { MarkdownViewer } from "../MarkdownViewer.js";

export interface RunNowHeaderProps {
  run: Run;
  now: RunNow;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

export function RunNowHeader({ run, now }: RunNowHeaderProps) {
  const headingId = `run-now-title-${run.id}`;
  return (
    <section className="run-now" aria-labelledby={headingId}>
      <h2 id={headingId} className="run-now-title">
        {now.title}
      </h2>
      <p className="run-now-sentence">{now.sentence}</p>

      {now.plan && (
        <div className="run-now-plan">
          <MarkdownViewer content={now.plan} />
        </div>
      )}

      {now.diff && (
        <p className="run-now-diff">
          {`${now.diff.files.length} ${plural(now.diff.files.length, "file", "files")} · +${now.diff.totalAdded} −${now.diff.totalRemoved}`}
        </p>
      )}

      {now.pullRequestUrl && (
        <div className="run-now-pr">
          {/* An external link stays a link, dressed as the secondary button it
              reads as: the arrow says it leaves the app. */}
          <a
            className="run-now-link ui-button ui-button--secondary ui-button--sm"
            href={now.pullRequestUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Pull Request ↗
          </a>
          {now.pullRequestOutcome?.status === "merged" &&
            now.pullRequestOutcome.mergedAt && (
              <time
                className="run-now-pr-time"
                dateTime={now.pullRequestOutcome.mergedAt}
              >
                {`Merged ${formatRelativeTime(now.pullRequestOutcome.mergedAt, Date.now())}`}
              </time>
            )}
          {now.pullRequestOutcome?.status === "closed" &&
            now.pullRequestOutcome.closedAt && (
              <time
                className="run-now-pr-time"
                dateTime={now.pullRequestOutcome.closedAt}
              >
                {`Closed ${formatRelativeTime(now.pullRequestOutcome.closedAt, Date.now())}`}
              </time>
            )}
        </div>
      )}

      {now.failure && (
        <div className="run-now-failure" role="status">
          <p className="run-now-failure-message">{now.failure.message}</p>
          <p className="run-now-failure-recovery">{now.failure.recovery}</p>
        </div>
      )}
    </section>
  );
}
