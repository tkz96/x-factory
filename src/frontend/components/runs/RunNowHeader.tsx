// src/frontend/components/runs/RunNowHeader.tsx — The run page's "now" header (#262, spec #241).
// It says what the run is doing or waiting for, in one sentence, with the one fact that sentence
// points at: the plan awaiting approval, the change summary, the pull request, or the failure
// and its recovery.

import "./RunNowHeader.css";

import type { Run } from "../../../shared/types.js";
import { formatRelativeTime } from "../../lib/format-timestamp.js";
import { plural } from "../../lib/plural.js";
import type { RunNow } from "../../lib/run-now.js";
import { MarkdownBlock } from "../MarkdownBlock.js";

export interface RunNowHeaderProps {
  run: Run;
  now: RunNow;
}

export function RunNowHeader({ run, now }: RunNowHeaderProps) {
  const headingId = `run-now-title-${run.id}`;
  return (
    <section className="run-now" aria-labelledby={headingId}>
      <h2 id={headingId} className="run-now-title text-title-3">
        {now.title}
      </h2>
      <p className="run-now-sentence text-body">{now.sentence}</p>

      {now.plan && (
        <div className="run-now-plan text-callout">
          <MarkdownBlock content={now.plan} label="Plan" compact foldable />
        </div>
      )}

      {now.diff && (
        <p className="run-now-diff text-caption-1">
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
                className="run-now-pr-time text-caption-1"
                dateTime={now.pullRequestOutcome.mergedAt}
              >
                {`Merged ${formatRelativeTime(now.pullRequestOutcome.mergedAt, Date.now())}`}
              </time>
            )}
          {now.pullRequestOutcome?.status === "closed" &&
            now.pullRequestOutcome.closedAt && (
              <time
                className="run-now-pr-time text-caption-1"
                dateTime={now.pullRequestOutcome.closedAt}
              >
                {`Closed ${formatRelativeTime(now.pullRequestOutcome.closedAt, Date.now())}`}
              </time>
            )}
        </div>
      )}

      {now.failure && (
        <div className="run-now-failure" role="status">
          <p className="run-now-failure-message text-headline">
            {now.failure.message}
          </p>
          <p className="run-now-failure-recovery text-callout">
            {now.failure.recovery}
          </p>
        </div>
      )}
    </section>
  );
}
