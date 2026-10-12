// src/frontend/components/runs/RunEvidence.tsx — The verification and review evidence of a run,
// shown in the inspector (#262). The checkpoint actions live in the checkpoint bar, not here.

import "./RunEvidence.css";

import type {
  ReviewResult,
  Run,
  VerificationResult,
} from "../../../shared/types.js";
import { RUN_EVIDENCE_COPY } from "../feedback/copy-map.js";
import { Badge, type BadgeTone } from "../ui/Badge.js";

function VerificationEvidenceSection({
  verification,
}: {
  verification?: VerificationResult | null;
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

  return (
    <div className="result-section" id="verification-section">
      <h3>Verification</h3>
      {verification ? (
        <>
          <div className="evidence-row flex-center gap-2 m-0 my-2">
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
          <Badge id="result-tests">Awaiting verification</Badge>
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
            <Badge
              id="result-review-badge"
              tone={review.passed ? "success" : "error"}
            >
              {review.passed ? "Passed" : "Failed"}
            </Badge>
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
                    <Badge
                      className="mr-2"
                      tone={c.satisfied ? "success" : "error"}
                    >
                      {c.satisfied ? "✓ Pass" : "✗ Fail"}
                    </Badge>
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
                    <Badge
                      className="mr-2"
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
          <Badge id="result-review-badge">Awaiting review</Badge>
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
