// src/frontend/components/runs/RunNowHeader.tsx — The run page's "now" header (#262, spec #241).
// It says what the run is doing or waiting for, in one sentence, with the one fact that sentence
// points at: the plan awaiting approval, the change summary, the pull request, or the failure
// and its recovery.

import "./RunNowHeader.css";

import type { Run } from "../../../shared/types.js";
import type { RunNow } from "../../lib/run-now.js";

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

      {now.plan && <div className="run-now-plan">{now.plan}</div>}

      {now.diff && (
        <p className="run-now-diff">
          {`${now.diff.files.length} ${plural(now.diff.files.length, "file", "files")} · +${now.diff.totalAdded} −${now.diff.totalRemoved}`}
        </p>
      )}

      {now.pullRequestUrl && (
        <a
          className="run-now-link"
          href={now.pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open Pull Request ↗
        </a>
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
