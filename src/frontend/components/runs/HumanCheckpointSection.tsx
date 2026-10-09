// src/frontend/components/runs/HumanCheckpointSection.tsx — Human delivery checkpoint and PR creation (XFM-50).

import "./HumanCheckpointSection.css";

import { useState } from "react";
import { runStatusLabel } from "../../../shared/run-status-policy.js";
import type {
  ReviewResult,
  Run,
  VerificationResult,
} from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";
import { usePrRun } from "../../hooks/useQueries.js";

interface HumanCheckpointSectionProps {
  run: Run;
  onApprove?: () => void;
  onReject?: () => void;
}

function VerificationEvidenceSection({
  verification,
}: {
  verification?: VerificationResult | null;
}) {
  const testOutput = verification?.tests?.stdout || verification?.tests?.stderr;

  return (
    <div className="result-section mt-4" id="verification-section">
      <h3>1. Deterministic Verification</h3>
      {verification ? (
        <>
          <div className="evidence-row flex-center gap-2 m-0 my-2">
            <span
              id="result-tests"
              className={`badge ${verification.passed ? "badge-success" : "badge-danger"}`}
            >
              {verification.passed ? "PASSED" : "FAILED"}
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
    <div className="result-section mt-4" id="review-section">
      <h3>2. Independent Review (Read-Only Session B)</h3>
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

interface DeliveryCheckpointSectionProps {
  run: Run;
  isPrCreated: boolean;
  prUrl: string | null;
  isPrPending: boolean;
  error: string | null;
  onApprove?: (() => void) | undefined;
  onReject?: (() => void) | undefined;
  onCreatePr: () => void;
}

function DeliveryCheckpointSection({
  run,
  isPrCreated,
  prUrl,
  isPrPending,
  error,
  onApprove,
  onReject,
  onCreatePr,
}: DeliveryCheckpointSectionProps) {
  const isAwaitingReview = run.status === "awaiting_review";

  return (
    <div className="delivery-checkpoint mt-6" id="delivery-checkpoint">
      <h3 className="m-0 mb-2">3. Delivery Checkpoint</h3>
      <p className="checkpoint-text text-muted m-0">
        {isAwaitingReview
          ? "Automated verification and code review complete. Awaiting human approval before pull request delivery."
          : "All automated verification tests passed and the read-only reviewer confirmed acceptance criteria. Confirm below to commit, push, and open the Pull Request."}
      </p>

      {isAwaitingReview && (onApprove || onReject) && (
        <div
          className="checkpoint-actions mt-4 flex-center gap-2"
          id="checkpoint-approval-actions"
        >
          {onApprove && (
            <button
              type="button"
              id="btn-approve"
              className="btn-primary"
              onClick={onApprove}
            >
              Approve Review &amp; Proceed to Delivery
            </button>
          )}
          {onReject && (
            <button
              type="button"
              id="btn-reject"
              className="btn-secondary btn-danger-text"
              onClick={onReject}
            >
              Request Rework
            </button>
          )}
        </div>
      )}

      {!isAwaitingReview && !isPrCreated ? (
        <div className="mt-4">
          <button
            type="button"
            id="btn-pr"
            className="btn-primary"
            onClick={onCreatePr}
            disabled={isPrPending}
          >
            {isPrPending ? "Creating Pull Request…" : "Create Pull Request"}
          </button>
        </div>
      ) : isPrCreated ? (
        <div id="pr-result" className="pr-result mt-4">
          <h4 className="pr-success-title">Pull Request Created</h4>
          {prUrl && (
            <a
              id="pr-link"
              href={prUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold"
            >
              Open Pull Request ↗
            </a>
          )}
        </div>
      ) : null}

      {error && (
        <div id="result-error" className="error-message mt-3">
          {error}
        </div>
      )}
    </div>
  );
}

export function HumanCheckpointSection({
  run,
  onApprove,
  onReject,
}: HumanCheckpointSectionProps) {
  const { openNewRunModal } = useModal();
  const prMutation = usePrRun();
  const prUrl = run.pullRequest?.url || null;
  const [error, setError] = useState<string | null>(null);

  const handleCreatePr = async () => {
    setError(null);
    try {
      await prMutation.mutateAsync({ runId: run.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isPrCreated = run.status === "pr_created" || Boolean(prUrl);

  return (
    <div id="view-result" className="view mt-4">
      <div className="card">
        <div className="run-header">
          <h2 id="result-heading">Human Checkpoint &amp; Evidence</h2>
          <span
            id="result-status-badge"
            className="badge"
            data-status={run.status}
          >
            {runStatusLabel(run.status)}
          </span>
        </div>

        <VerificationEvidenceSection verification={run.verification} />
        <ReviewEvidenceSection review={run.review} />
        <DeliveryCheckpointSection
          run={run}
          isPrCreated={isPrCreated}
          prUrl={prUrl}
          isPrPending={prMutation.isPending}
          error={error}
          onApprove={onApprove}
          onReject={onReject}
          onCreatePr={handleCreatePr}
        />

        <button
          type="button"
          id="btn-new"
          className="btn-secondary mt-6"
          onClick={() => openNewRunModal()}
        >
          Start New Run
        </button>
      </div>
    </div>
  );
}
