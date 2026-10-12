// src/frontend/components/runs/RunEvidence.tsx — The verification and review evidence of a run,
// shown in the inspector (#262). The checkpoint actions live in the checkpoint bar, not here.

import "./RunEvidence.css";

import type {
  ReviewResult,
  Run,
  VerificationResult,
} from "../../../shared/types.js";
import { RUN_EVIDENCE_COPY } from "../feedback/copy-map.js";

function VerificationEvidenceSection({
  verification,
}: {
  verification?: VerificationResult | null;
}) {
  const testOutput = verification?.tests?.stdout || verification?.tests?.stderr;
  // No test command: the tests did not run, so the checks are never shown as
  // a pass — only as failed (another check failed) or as "no tests ran".
  const testsNotRun = verification?.tests?.skipped === true;
  const badge = !verification?.passed
    ? { label: "FAILED", tone: "badge-danger" }
    : testsNotRun
      ? { label: RUN_EVIDENCE_COPY.noTestsBadge, tone: "badge-neutral" }
      : { label: "PASSED", tone: "badge-success" };

  return (
    <div className="result-section" id="verification-section">
      <h3>Verification</h3>
      {verification ? (
        <>
          <div className="evidence-row flex-center gap-2 m-0 my-2">
            <span id="result-tests" className={`badge ${badge.tone}`}>
              {badge.label}
            </span>
            <span id="result-repair-count" className="badge badge-neutral">
              {verification.summary ||
                (verification.passed
                  ? "Deterministic checks passed"
                  : "Deterministic checks failed")}
            </span>
            {verification.repairAttempt > 1 && (
              <span id="result-attempt-badge" className="badge badge-neutral">
                Attempt {verification.repairAttempt}
              </span>
            )}
            {verification.hasPollution && (
              <span id="result-pollution-badge" className="badge badge-danger">
                Repository Pollution Detected
              </span>
            )}
          </div>
          {testsNotRun && (
            <p
              id="result-tests-not-run"
              className="text-footnote text-muted my-1"
            >
              {RUN_EVIDENCE_COPY.noTestCommand}
            </p>
          )}
          {verification.filesChanged &&
            verification.filesChanged.length > 0 && (
              <div
                className="text-footnote text-muted my-1"
                id="verification-files"
              >
                Files modified: {verification.filesChanged.join(", ")}
              </div>
            )}
          {testOutput && (
            <pre id="result-test-output" className="test-output">
              {testOutput}
            </pre>
          )}
        </>
      ) : (
        <div
          className="evidence-row flex-center gap-2 m-0 my-2"
          id="verification-empty-state"
        >
          <span id="result-tests" className="badge badge-neutral">
            AWAITING VERIFICATION
          </span>
          <span id="result-repair-count" className="text-muted text-footnote">
            No verification results available yet.
          </span>
        </div>
      )}
    </div>
  );
}

function ReviewEvidenceSection({ review }: { review?: ReviewResult | null }) {
  return (
    <div className="result-section" id="review-section">
      <h3>Review</h3>
      {review ? (
        <>
          <div className="evidence-row flex-center gap-2 m-0 my-2">
            <span
              id="result-review-badge"
              className={`badge ${review.passed ? "badge-success" : "badge-danger"}`}
            >
              {review.passed ? "PASSED" : "FAILED"}
            </span>
            <span id="result-review-summary" className="evidence-text">
              {review.summary}
            </span>
          </div>

          {review.criteriaChecked && review.criteriaChecked.length > 0 && (
            <div id="criteria-checklist" className="criteria-list">
              <h4 className="text-footnote mt-3">
                Acceptance Criteria Verified:
              </h4>
              <ul className="list-none">
                {review.criteriaChecked.map((c) => (
                  <li key={c.criterion} className="my-1">
                    <span
                      className={`badge badge-xs mr-2 ${
                        c.satisfied
                          ? "badge-success-subtle"
                          : "badge-danger-subtle"
                      }`}
                    >
                      {c.satisfied ? "✓ PASS" : "✗ FAIL"}
                    </span>
                    <span>{c.criterion}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {review.findings && review.findings.length > 0 && (
            <div id="review-findings" className="findings-list mt-3">
              <h4 className="text-footnote">Findings:</h4>
              <ul className="list-none">
                {review.findings.map((f) => (
                  <li
                    key={`${f.file ?? ""}:${f.line ?? ""}:${f.message}`}
                    className="my-1 text-footnote"
                  >
                    <span
                      className={`badge badge-xs mr-2 ${
                        f.severity === "error"
                          ? "badge-danger"
                          : f.severity === "warning"
                            ? "badge-warning"
                            : "badge-neutral"
                      }`}
                    >
                      {f.severity.toUpperCase()}
                    </span>
                    {f.file ? (
                      <span className="font-mono">
                        {f.file}
                        {f.line ? `:${f.line}` : ""}:{" "}
                      </span>
                    ) : null}
                    <span>{f.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div
          className="evidence-row flex-center gap-2 m-0 my-2"
          id="review-empty-state"
        >
          <span id="result-review-badge" className="badge badge-neutral">
            AWAITING REVIEW
          </span>
          <span id="result-review-summary" className="text-muted text-footnote">
            No review results available yet.
          </span>
        </div>
      )}
    </div>
  );
}

export function RunEvidence({ run }: { run: Run }) {
  return (
    <div className="run-evidence" id="run-evidence">
      <VerificationEvidenceSection verification={run.verification} />
      <ReviewEvidenceSection review={run.review} />
    </div>
  );
}
