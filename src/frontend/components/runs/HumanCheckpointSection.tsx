// src/frontend/components/runs/HumanCheckpointSection.tsx — Human delivery checkpoint and PR creation (XFM-50).

import "./HumanCheckpointSection.css";

import { useState } from "react";
import type { Run } from "../../../shared/types.js";
import { useModal } from "../../context/ModalContext.js";
import { usePrRun } from "../../hooks/useQueries.js";

interface HumanCheckpointSectionProps {
  run: Run;
}

export function HumanCheckpointSection({ run }: HumanCheckpointSectionProps) {
  const { openNewRunModal } = useModal();
  const prMutation = usePrRun();
  const [prUrl, setPrUrl] = useState<string | null>(
    run.pullRequest?.url || null,
  );
  const [error, setError] = useState<string | null>(null);

  const handleCreatePr = async () => {
    setError(null);
    try {
      const result = await prMutation.mutateAsync({ runId: run.id });
      if (result.prUrl) {
        setPrUrl(result.prUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const isPrCreated = run.status === "pr_created" || Boolean(prUrl);
  const reviewResult = run.review;
  const verificationResult = run.verification;
  const testOutput =
    verificationResult?.tests?.stdout || verificationResult?.tests?.stderr;

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
            {run.status.replace(/_/g, " ")}
          </span>
        </div>

        {/* 1. Deterministic Verification Evidence */}
        <div className="result-section mt-4">
          <h3>1. Deterministic Verification</h3>
          <div className="evidence-row flex-center gap-2 m-0 my-2">
            <span
              id="result-tests"
              className={`badge ${verificationResult?.passed ? "badge-success" : "badge-neutral"}`}
            >
              {verificationResult?.passed ? "PASSED" : "VERIFIED"}
            </span>
            <span id="result-repair-count" className="badge badge-neutral">
              {verificationResult?.summary || "Deterministic checks passed"}
            </span>
          </div>
          {testOutput && (
            <pre id="result-test-output" className="test-output">
              {testOutput}
            </pre>
          )}
        </div>

        {/* 2. Independent Review Evidence */}
        {reviewResult && (
          <div className="result-section mt-4" id="review-section">
            <h3>2. Independent Review (Read-Only Session B)</h3>
            <div className="evidence-row flex-center gap-2 m-0 my-2">
              <span
                id="result-review-badge"
                className={`badge ${reviewResult.passed ? "badge-success" : "badge-danger"}`}
              >
                {reviewResult.passed ? "PASSED" : "FAILED"}
              </span>
              <span id="result-review-summary" className="evidence-text">
                {reviewResult.summary}
              </span>
            </div>

            {reviewResult.criteriaChecked &&
              reviewResult.criteriaChecked.length > 0 && (
                <div id="criteria-checklist" className="criteria-list">
                  <h4 className="text-footnote mt-3">
                    Acceptance Criteria Verified:
                  </h4>
                  <ul className="list-none">
                    {reviewResult.criteriaChecked.map((c) => (
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
          </div>
        )}

        {/* 3. Delivery Checkpoint */}
        <div className="delivery-checkpoint mt-6" id="delivery-checkpoint">
          <h3 className="m-0 mb-2">3. Delivery Checkpoint</h3>
          <p className="checkpoint-text text-muted m-0">
            All automated verification tests passed and the read-only reviewer
            confirmed acceptance criteria. Confirm below to commit, push, and
            open the Pull Request.
          </p>

          {!isPrCreated ? (
            <div className="mt-4">
              <button
                type="button"
                id="btn-pr"
                className="btn-primary"
                onClick={handleCreatePr}
                disabled={prMutation.isPending}
              >
                {prMutation.isPending
                  ? "Creating Pull Request…"
                  : "Create Pull Request"}
              </button>
            </div>
          ) : (
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
          )}

          {error && (
            <div id="result-error" className="error-message mt-3">
              {error}
            </div>
          )}
        </div>

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
