// src/frontend/components/runs/RunInspector.tsx — The "Run details" pane (#262, spec #241): the run's
// branch, ticket and pull request, the ticket as the run received it, the models that did its work, the files it changed and its evidence.
// The raw activity log opens from the footer. Beside the chat on a wide window; a sheet at phone width.

import "./RunPanel.css";
import "./RunInspector.css";

import { type ReactNode, useState } from "react";
import { reviewCriterionStatus } from "../../../shared/review-criterion-status.js";
import { TERMINAL_RUN_STATUSES } from "../../../shared/run-status-policy.js";
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
import { formatRunDate } from "../../lib/format-timestamp.js";
import { usageFor } from "../../lib/run-models.js";
import {
  DialogBody,
  DialogCloseButton,
  DialogHeader,
  DialogTitle,
  Sheet,
} from "../overlays/index.js";
import { Button } from "../ui/Button.js";
import { Icon } from "../ui/Icon.js";
import { useCopyToClipboard } from "../ui/useCopyToClipboard.js";
import { ChatThread } from "./ChatThread.js";
import { DiffModal } from "./DiffModal.js";
import { useDetailsSheet } from "./RunDetailsContext.js";
import { RunTicket } from "./RunTicket.js";
import { TokenUsage } from "./TokenUsage.js";

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
const VERDICT_NOT_RUN: Verdict = { text: "Not run", tone: "muted" };
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
  finished: boolean,
): { key: string; label: string; verdict: Verdict }[] {
  // A finished run with no result never ran the check; a running one has not got there yet.
  const pending = finished ? VERDICT_NOT_RUN : VERDICT_AWAITING;
  let tests: Verdict = VERDICT_PASS;
  if (verification === null) tests = pending;
  else if (!verification.passed) tests = VERDICT_FAIL;
  else if (verification.tests?.skipped === true) tests = VERDICT_NOT_RUN;

  let reviewVerdict: Verdict = pending;
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

/** What a row does when pressed: open a page, or copy its value. */
type RowAction =
  | { kind: "link"; href: string }
  | { kind: "copy"; text: string };

/** The control that makes a whole row its target; it stretches over the row. */
function RowActionControl({
  action,
  label,
  children,
}: {
  action: RowAction;
  label: string;
  children: ReactNode;
}) {
  const { copied, copy } = useCopyToClipboard();
  if (action.kind === "link") {
    return (
      <a
        className="run-inspector-link run-inspector-stretch"
        href={action.href}
        target="_blank"
        rel="noreferrer"
      >
        {children}
      </a>
    );
  }
  return (
    <>
      <Button
        variant="quiet"
        className="run-inspector-stretch run-inspector-copy"
        aria-label={`Copy ${label} ${action.text}`}
        onPress={() => void copy(action.text)}
      >
        <span className="run-inspector-copy-text">{children}</span>
        <Icon name={copied ? "icon-check" : "icon-copy"} size="xs" />
      </Button>
      {/* The copy is announced through the CopyButton live node, so the button's
          name can keep holding the visible value (#319, US22). */}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </>
  );
}

/**
 * One label on the left, one mono value on the right: the pane's only row shape. A row with
 * an action is one target, with the shared row hover; a row without one has no hover, so a
 * fill never promises an action that does not exist.
 */
function DetailRow({
  label,
  value,
  tone,
  kind = "truncate",
  action,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone | undefined;
  /** "status" never shrinks, "wrap" wraps onto more lines, "truncate" (the default) cuts with an ellipsis. */
  kind?: "truncate" | "status" | "wrap";
  action?: RowAction | undefined;
}) {
  const classes = ["run-inspector-value"];
  if (kind !== "truncate") classes.push(`run-inspector-value--${kind}`);
  if (tone) classes.push(`run-inspector-value--${tone}`);
  return (
    <div
      className={`run-inspector-row text-callout${action ? " ui-row-hover" : ""}`}
    >
      <dt className="run-inspector-label" title={label}>
        {label}
      </dt>
      <dd
        className={classes.join(" ")}
        title={typeof value === "string" ? value : undefined}
      >
        {action ? (
          <RowActionControl action={action} label={label}>
            {value}
          </RowActionControl>
        ) : (
          value
        )}
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
  const checks = evidenceChecks(
    run.verification,
    run.review,
    TERMINAL_RUN_STATUSES.has(run.status),
  );
  const pullRequest = run.pullRequest;
  const ticketUrl = run.ticket.url;
  const logCount = `${events.length} ${plural(events.length, "event", "events")}`;

  return (
    <>
      <header className="run-panel-header">
        <h2 id="run-inspector-title" className="run-panel-title text-headline">
          Run details
        </h2>
      </header>

      <div className="run-panel-scroll">
        <div className="run-inspector-body">
          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-run"
          >
            <h3
              id="run-inspector-run"
              className="run-inspector-caption text-headline"
            >
              Run
            </h3>
            <dl className="run-inspector-rows">
              <DetailRow
                label="Branch"
                value={run.branch || "None yet"}
                tone={run.branch ? undefined : "muted"}
                action={
                  run.branch ? { kind: "copy", text: run.branch } : undefined
                }
              />
              <DetailRow
                label="Ticket"
                value={run.ticket.id}
                action={
                  ticketUrl ? { kind: "link", href: ticketUrl } : undefined
                }
              />
              <DetailRow
                label="Pull request"
                value={
                  pullRequest ? pullRequestLabel(pullRequest.url) : "None yet"
                }
                tone={pullRequest ? undefined : "muted"}
                action={
                  pullRequest
                    ? { kind: "link", href: pullRequest.url }
                    : undefined
                }
              />
              <DetailRow label="Started" value={formatRunDate(run.startedAt)} />
            </dl>
          </section>

          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-ticket"
          >
            <h3
              id="run-inspector-ticket"
              className="run-inspector-caption text-headline"
            >
              Ticket
            </h3>
            <RunTicket ticket={run.ticket} idPrefix="run-inspector-ticket" />
          </section>

          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-models"
          >
            <h3
              id="run-inspector-models"
              className="run-inspector-caption text-headline"
            >
              Models
            </h3>
            <dl className="run-inspector-rows">
              {MODEL_ROLES.map(({ role, label }) => {
                const usage = usageFor(run.stageModels ?? [], role);
                if (usage) {
                  return (
                    <DetailRow
                      key={role}
                      label={label}
                      kind="wrap"
                      value={
                        <span className="run-inspector-model">
                          <span>{usage.modelId}</span>
                          <TokenUsage usage={usage} />
                        </span>
                      }
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
              <h3
                id="run-inspector-files"
                className="run-inspector-caption text-headline"
              >
                Files
              </h3>
              {files.length > 0 && (
                <span className="run-inspector-note text-caption-1">
                  {`${files.length} ${plural(files.length, "file", "files")} · +${totalAdded} −${totalRemoved}`}
                </span>
              )}
            </div>
            {files.length === 0 ? (
              <p className="run-inspector-none text-callout">No changes yet.</p>
            ) : (
              <ul className="run-inspector-files">
                {files.map((file) => (
                  <li key={file.file}>
                    <Button
                      variant="quiet"
                      className="run-inspector-file ui-row-hover text-callout"
                      onPress={() => setDiffFile(file)}
                    >
                      <span className="run-inspector-label run-inspector-file-path">
                        {file.file}
                      </span>
                      <span className="run-inspector-file-counts">
                        <span className="run-inspector-add">{`+${file.added}`}</span>{" "}
                        <span className="run-inspector-remove">{`−${file.removed}`}</span>
                      </span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            className="run-inspector-section"
            aria-labelledby="run-inspector-evidence"
          >
            <h3
              id="run-inspector-evidence"
              className="run-inspector-caption text-headline"
            >
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
            <span>Raw Log</span>
            <span className="run-inspector-count text-caption-1">
              {logCount}
            </span>
          </span>
          <Icon
            name="icon-chevron-right"
            size="sm"
            className="run-inspector-chevron"
          />
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
  const { sheetOpen: open, setSheetOpen: setOpen } = useDetailsSheet();
  return (
    <>
      {/* A labelled button: it sits in the chat's header strip at phone width, and carries the branch. */}
      <Button
        variant="quiet"
        size="sm"
        icon="icon-info"
        onPress={() => setOpen(true)}
      >
        Details
      </Button>
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
