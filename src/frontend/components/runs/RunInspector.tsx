// src/frontend/components/runs/RunInspector.tsx — The "Run details" pane (#262, spec #241): the run's
// branch, ticket and pull request, the models that did its work, the files it changed and its evidence.
// The raw activity log opens from the footer. Beside the chat on a wide window; a sheet at phone width.

import "./RunPanel.css";
import "./RunInspector.css";

import { type ReactNode, useState } from "react";
import { reviewCriterionStatus } from "../../../shared/review-criterion-status.js";
import type {
  ModelRoleName,
  ReviewResult,
  Run,
  RunEvent,
  VerificationResult,
} from "../../../shared/types.js";
import {
  type ParsedDiffFile,
  parseDiffToFiles,
} from "../../lib/diff-parser.js";
import { formatUsage, latestModelFor } from "../../lib/run-models.js";
import {
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
  Sheet,
} from "../overlays/index.js";
import { Button } from "../ui/Button.js";
import { IconButton } from "../ui/IconButton.js";
import { ChatThread } from "./ChatThread.js";
import { DiffModal } from "./DiffModal.js";

export interface RunInspectorProps {
  run: Run;
  events: RunEvent[];
  connected: boolean;
}

type Tone = "muted" | "pass" | "fail";

interface Verdict {
  text: string;
  tone: Tone;
}

const VERDICT_PASS: Verdict = { text: "Pass", tone: "pass" };
const VERDICT_FAIL: Verdict = { text: "Fail", tone: "fail" };
const VERDICT_AWAITING: Verdict = { text: "Awaiting", tone: "muted" };
const VERDICT_NOT_ASSESSED: Verdict = { text: "Not assessed", tone: "muted" };

const MODEL_ROLES: readonly { role: ModelRoleName; label: string }[] = [
  { role: "builder", label: "Builder" },
  { role: "reviewer", label: "Reviewer" },
];

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "#12" for a GitHub-style pull request URL; the URL itself otherwise. */
function pullRequestLabel(url: string): string {
  const match = /\/pull\/(\d+)/.exec(url);
  return match ? `#${match[1]}` : url;
}

/** The checks the Evidence section lists: tests, the review, then each acceptance criterion. */
function evidenceChecks(
  verification: VerificationResult | null,
  review: ReviewResult | null,
): { key: string; label: string; verdict: Verdict }[] {
  let tests: Verdict = VERDICT_PASS;
  if (verification === null) tests = VERDICT_AWAITING;
  else if (!verification.passed) tests = VERDICT_FAIL;
  else if (verification.tests?.skipped === true)
    tests = { text: "Not run", tone: "muted" };

  let reviewVerdict: Verdict = VERDICT_AWAITING;
  if (review !== null)
    reviewVerdict = review.passed ? VERDICT_PASS : VERDICT_FAIL;

  const criteria = (review?.criteriaChecked ?? []).map((check, index) => {
    const status = reviewCriterionStatus(check);
    return {
      key: `criterion-${index}`,
      label: check.criterion,
      // A criterion the Reviewer never judged reads as such — never as a pass.
      verdict:
        status === "pass"
          ? VERDICT_PASS
          : status === "fail"
            ? VERDICT_FAIL
            : VERDICT_NOT_ASSESSED,
    };
  });

  return [
    { key: "tests", label: "Tests", verdict: tests },
    { key: "review", label: "Review", verdict: reviewVerdict },
    ...criteria,
  ];
}

/** One label on the left, one mono value on the right: the pane's only row shape. */
function DetailRow({
  label,
  value,
  tone,
  kind = "truncate",
}: {
  label: string;
  value: ReactNode;
  tone?: Tone | undefined;
  /** "status" never shrinks, "wrap" wraps onto more lines, "truncate" (the default) cuts with an ellipsis. */
  kind?: "truncate" | "status" | "wrap";
}) {
  const classes = ["run-inspector-value"];
  if (kind !== "truncate") classes.push(`run-inspector-value--${kind}`);
  if (tone) classes.push(`run-inspector-value--${tone}`);
  return (
    <div className="run-inspector-row">
      <dt className="run-inspector-label" title={label}>
        {label}
      </dt>
      <dd
        className={classes.join(" ")}
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

/** The pane's contents: header strip, scrolling sections, and the raw log footer. */
function RunDetailsPane({ run, events, connected }: RunInspectorProps) {
  const [logOpen, setLogOpen] = useState(false);
  const [diffFile, setDiffFile] = useState<ParsedDiffFile | null>(null);
  const files = parseDiffToFiles(run.diff);
  const totalAdded = files.reduce((sum, file) => sum + file.added, 0);
  const totalRemoved = files.reduce((sum, file) => sum + file.removed, 0);
  const checks = evidenceChecks(run.verification, run.review);
  const pullRequest = run.pullRequest;
  const ticketUrl = run.ticket.url;
  const logCount = `${events.length} ${plural(events.length, "event", "events")}`;

  return (
    <>
      <header className="run-panel-header">
        <h2 id="run-inspector-title" className="run-panel-title">
          Run details
        </h2>
      </header>

      <div className="run-panel-scroll">
        <div className="run-inspector-body">
          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-run"
          >
            <h3 id="run-inspector-run" className="run-inspector-caption">
              Run
            </h3>
            <dl className="run-inspector-rows">
              <DetailRow
                label="Branch"
                value={run.branch || "None yet"}
                tone={run.branch ? undefined : "muted"}
              />
              <DetailRow
                label="Ticket"
                value={
                  ticketUrl ? (
                    <a
                      className="run-inspector-link"
                      href={ticketUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {run.ticket.id}
                    </a>
                  ) : (
                    run.ticket.id
                  )
                }
              />
              <DetailRow
                label="Pull request"
                value={
                  pullRequest ? (
                    <a
                      className="run-inspector-link"
                      href={pullRequest.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {pullRequestLabel(pullRequest.url)}
                    </a>
                  ) : (
                    "None yet"
                  )
                }
                tone={pullRequest ? undefined : "muted"}
              />
            </dl>
          </section>

          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-models"
          >
            <h3 id="run-inspector-models" className="run-inspector-caption">
              Models
            </h3>
            <dl className="run-inspector-rows">
              {MODEL_ROLES.map(({ role, label }) => {
                const use = latestModelFor(run.stageModels ?? [], role);
                if (use) {
                  const usage = formatUsage(use);
                  return (
                    <DetailRow
                      key={role}
                      label={label}
                      kind="wrap"
                      value={usage ? `${use.modelId} · ${usage}` : use.modelId}
                    />
                  );
                }
                return (
                  <DetailRow
                    key={role}
                    label={label}
                    value="None yet"
                    tone="muted"
                  />
                );
              })}
            </dl>
          </section>

          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-files"
          >
            <div className="run-inspector-caption-row">
              <h3 id="run-inspector-files" className="run-inspector-caption">
                Files
              </h3>
              {files.length > 0 && (
                <span className="run-inspector-note">
                  {`${files.length} ${plural(files.length, "file", "files")} · +${totalAdded} −${totalRemoved}`}
                </span>
              )}
            </div>
            {files.length === 0 ? (
              <p className="run-inspector-empty">No changes yet.</p>
            ) : (
              <ul className="run-inspector-files">
                {files.map((file) => (
                  <li key={file.file}>
                    <button
                      type="button"
                      className="run-inspector-file"
                      onClick={() => setDiffFile(file)}
                    >
                      <span className="run-inspector-label run-inspector-file-path">
                        {file.file}
                      </span>
                      <span className="run-inspector-file-counts">
                        <span className="run-inspector-add">{`+${file.added}`}</span>{" "}
                        <span className="run-inspector-remove">{`−${file.removed}`}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-evidence"
          >
            <h3 id="run-inspector-evidence" className="run-inspector-caption">
              Evidence
            </h3>
            <dl className="run-inspector-rows">
              {checks.map((check) => (
                <DetailRow
                  key={check.key}
                  label={check.label}
                  kind="status"
                  value={check.verdict.text}
                  tone={check.verdict.tone}
                />
              ))}
            </dl>
          </section>
        </div>
      </div>

      <footer className="run-inspector-footer">
        <Button
          variant="quiet"
          className="run-inspector-raw-log"
          onPress={() => setLogOpen(true)}
        >
          <span className="run-inspector-raw-log-main">
            {connected && (
              <>
                <span className="run-inspector-live-dot" aria-hidden="true" />
                <span className="sr-only">Live stream connected. </span>
              </>
            )}
            <span>Raw log</span>
            <span className="run-inspector-count">{logCount}</span>
          </span>
          <svg
            className="icon icon-sm run-inspector-chevron"
            aria-hidden="true"
          >
            <use href="/assets/icons/sprite.svg#icon-chevron-right" />
          </svg>
        </Button>
      </footer>

      <DiffModal
        isOpen={diffFile !== null}
        file={diffFile?.file ?? null}
        added={diffFile?.added ?? 0}
        removed={diffFile?.removed ?? 0}
        hunks={diffFile?.hunks ?? ""}
        onClose={() => setDiffFile(null)}
      />

      <Sheet
        isOpen={logOpen}
        onClose={() => setLogOpen(false)}
        position="bottom"
        id="run-raw-log-sheet"
        ariaLabel="Raw log"
        className="run-inspector-log-sheet"
      >
        <DialogHeader>
          <DialogTitle>Raw log</DialogTitle>
          <DialogCloseButton onClose={() => setLogOpen(false)} />
        </DialogHeader>
        <DialogBody className="run-inspector-log">
          <ChatThread events={events} />
        </DialogBody>
      </Sheet>
    </>
  );
}

/** The "Run details" pane beside the chat, for a wide window. */
export function RunInspector(props: RunInspectorProps) {
  return (
    <aside
      className="run-panel run-inspector"
      aria-labelledby="run-inspector-title"
    >
      <RunDetailsPane {...props} />
    </aside>
  );
}

/** The same pane at phone width: a labelled button that opens it as a sheet. */
export function RunInspectorSheet(props: RunInspectorProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* An icon button named "Details": it sits in the chat's header strip at phone width. */}
      <IconButton
        label="Details"
        icon="icon-info"
        variant="plain"
        onPress={() => setOpen(true)}
      />
      <Sheet
        isOpen={open}
        onClose={() => setOpen(false)}
        position="bottom"
        id="run-inspector-sheet"
        ariaLabel="Run details"
        className="run-inspector-sheet"
      >
        <div className="run-panel run-inspector run-inspector-in-sheet">
          <RunDetailsPane {...props} />
        </div>
      </Sheet>
    </>
  );
}
