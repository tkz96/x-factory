// src/frontend/components/runs/RunEvidence.tsx — The verification and review evidence of a run,
// shown in the inspector (#262). The checkpoint actions live in the checkpoint bar, not here.

import "./RunEvidence.css";

import { summarizeDiff } from "../../../shared/diff-summary.js";
import type {
  ReviewResult,
  Run,
  VerificationResult,
} from "../../../shared/types.js";
import { RUN_EVIDENCE_COPY } from "../feedback/copy-map.js";
import { Badge, type BadgeTone } from "../ui/Badge.js";

/** The one glyph a criterion leads with: decorative, named in words beside it. */
function EvidenceIcon({ icon, tone }: { icon: string; tone: "pass" | "fail" }) {
  return (
    <svg
      className={`icon icon-sm evidence-icon evidence-icon--${tone}`}
      aria-hidden="true"
    >
      <use href={`/assets/icons/sprite.svg#${icon}`} />
    </svg>
  );
}

function VerificationEvidenceSection({
  verification,
  filesListedElsewhere,
}: {
  verification?: VerificationResult | null;
  /** The inspector's Files section already lists this run's files. */
  filesListedElsewhere: boolean;
}) {
  const testOutput = verification?.tests?.stdout || verification?.tests?.stderr;
  // No test command: the tests did not run, so the checks are never shown as
  // a pass — only as failed (another check failed) or as "no tests ran".
  const testsNotRun = verification?.tests?.skipped === true;
  const badge: { label: string; tone: BadgeTone } = !verification?.passed
    ? { label: "Failed", tone: "error" }
    : testsNotRun
      ? { label: RUN_EVIDENCE_COPY.noTestsBadge, tone: "neutral" }
      : { label: "Passed", tone: "success" };
  const filesChanged = verification?.filesChanged ?? [];
  const showFiles = filesChanged.length > 0 && !filesListedElsewhere;

  return (
    <section className="result-section" id="verification-section">
      <h3>Verification</h3>
      {verification ? (
        <>
          <div className="evidence-row">
            <Badge id="result-tests" tone={badge.tone}>
              {badge.label}
            </Badge>
            <Badge id="result-repair-count">
              {verification.summary ||
                (verification.passed
                  ? "Deterministic checks passed"
                  : "Deterministic checks failed")}
            </Badge>
            {verification.repairAttempt > 1 && (
              <Badge id="result-attempt-badge">
                Attempt {verification.repairAttempt}
              </Badge>
            )}
            {verification.hasPollution && (
              <Badge id="result-pollution-badge" tone="error">
                Repository Pollution Detected
              </Badge>
            )}
          </div>
          {testsNotRun && (
            <p id="result-tests-not-run" className="evidence-note">
              {RUN_EVIDENCE_COPY.noTestCommand}
            </p>
          )}
          {showFiles && (
            <p className="evidence-note" id="verification-files">
              Files modified: {filesChanged.join(", ")}
            </p>
          )}
          {testOutput && (
            <pre id="result-test-output" className="test-output">
              {testOutput}
            </pre>
          )}
        </>
      ) : (
        <div className="evidence-row" id="verification-empty-state">
          <Badge id="result-tests">Awaiting verification</Badge>
          <span id="result-repair-count" className="evidence-note">
            No verification results available yet.
          </span>
        </div>
      )}
    </section>
  );
}

function ReviewEvidenceSection({ review }: { review?: ReviewResult | null }) {
  return (
    <section className="result-section" id="review-section">
      <h3>Review</h3>
      {review ? (
        <>
          <div className="evidence-row">
            <Badge
              id="result-review-badge"
              tone={review.passed ? "success" : "error"}
            >
              {review.passed ? "Passed" : "Failed"}
            </Badge>
            <span id="result-review-summary" className="evidence-note">
              {review.summary}
            </span>
          </div>

          {review.criteriaChecked && review.criteriaChecked.length > 0 && (
            <div id="criteria-checklist" className="criteria-list">
              {/* A section header: the case it was written in, and no colon. */}
              <h4 className="evidence-subheading">Acceptance criteria</h4>
              <ul className="evidence-rows">
                {review.criteriaChecked.map((c) => (
                  <li key={c.criterion} className="evidence-grid-row">
                    <EvidenceIcon
                      icon={c.satisfied ? "icon-check" : "icon-x-circle"}
                      tone={c.satisfied ? "pass" : "fail"}
                    />
                    <span className="sr-only">
                      {c.satisfied ? "Passed: " : "Failed: "}
                    </span>
                    <span className="evidence-text">{c.criterion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.findings && review.findings.length > 0 && (
            <div id="review-findings" className="criteria-list">
              <h4 className="evidence-subheading">Findings</h4>
              <ul className="evidence-rows">
                {review.findings.map((f) => (
                  <li
                    key={`${f.file ?? ""}:${f.line ?? ""}:${f.message}`}
                    className="evidence-grid-row evidence-grid-row--badge"
                  >
                    <Badge
                      tone={
                        f.severity === "error"
                          ? "error"
                          : f.severity === "warning"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {f.severity}
                    </Badge>
                    <span className="evidence-text">
                      {f.file ? (
                        <span className="evidence-file">
                          {`${f.file}${f.line ? `:${f.line}` : ""} `}
                        </span>
                      ) : null}
                      {f.message}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className="evidence-row" id="review-empty-state">
          <Badge id="result-review-badge">Awaiting review</Badge>
          <span id="result-review-summary" className="evidence-note">
            No review results available yet.
          </span>
        </div>
      )}
    </section>
  );
}

export function RunEvidence({ run }: { run: Run }) {
  // The inspector lists a run's files in its own Files section once the run has
  // recorded a diff; the verification's own list would only repeat it.
  const filesListedElsewhere = summarizeDiff(run.diff).files.length > 0;
  return (
    <div className="run-evidence" id="run-evidence">
      <VerificationEvidenceSection
        verification={run.verification}
        filesListedElsewhere={filesListedElsewhere}
      />
      <ReviewEvidenceSection review={run.review} />
    </div>
  );
}
