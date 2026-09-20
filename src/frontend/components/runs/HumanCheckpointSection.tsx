// src/frontend/components/runs/HumanCheckpointSection.tsx — Human delivery checkpoint and PR creation (XFM-50).

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
    <div id="view-result" className="view" style={{ marginTop: "1.2rem" }}>
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
        <div className="result-section" style={{ marginTop: "1.2rem" }}>
          <h3>1. Deterministic Verification</h3>
          <div
            className="evidence-row"
            style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0" }}
          >
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
            <pre
              id="result-test-output"
              className="test-output"
              style={{
                maxHeight: "200px",
                overflow: "auto",
                fontFamily: "var(--font-mono)",
                fontSize: "0.8rem",
                padding: "0.8rem",
                background: "var(--bg-tertiary)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {testOutput}
            </pre>
          )}
        </div>

        {/* 2. Independent Review Evidence */}
        {reviewResult && (
          <div
            className="result-section"
            id="review-section"
            style={{ marginTop: "1.2rem" }}
          >
            <h3>2. Independent Review (Read-Only Session B)</h3>
            <div
              className="evidence-row"
              style={{ display: "flex", gap: "0.5rem", margin: "0.5rem 0" }}
            >
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
                  <h4 style={{ fontSize: "0.85rem", marginTop: "0.8rem" }}>
                    Acceptance Criteria Verified:
                  </h4>
                  <ul style={{ listStyle: "none", padding: 0 }}>
                    {reviewResult.criteriaChecked.map((c) => (
                      <li key={c.criterion} style={{ margin: "0.3rem 0" }}>
                        <span
                          className="badge badge-xs"
                          style={{
                            marginRight: "0.5rem",
                            background: c.satisfied
                              ? "var(--bg-success-subtle)"
                              : "var(--bg-danger-subtle)",
                            color: c.satisfied
                              ? "var(--success)"
                              : "var(--danger)",
                          }}
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
        <div
          className="delivery-checkpoint"
          id="delivery-checkpoint"
          style={{
            marginTop: "1.5rem",
            padding: "1.2rem",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            background: "var(--bg-secondary)",
          }}
        >
          <h3 style={{ margin: "0 0 0.5rem" }}>3. Delivery Checkpoint</h3>
          <p className="checkpoint-text text-muted" style={{ margin: 0 }}>
            All automated verification tests passed and the read-only reviewer
            confirmed acceptance criteria. Confirm below to commit, push, and
            open the Pull Request.
          </p>

          {!isPrCreated ? (
            <div style={{ marginTop: "1rem" }}>
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
            <div
              id="pr-result"
              className="pr-result"
              style={{
                marginTop: "1rem",
                padding: "0.8rem",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-success-subtle)",
                border: "1px solid var(--success)",
              }}
            >
              <h4 style={{ margin: "0 0 0.4rem", color: "var(--success)" }}>
                Pull Request Created
              </h4>
              {prUrl && (
                <a
                  id="pr-link"
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontWeight: 600 }}
                >
                  Open Pull Request ↗
                </a>
              )}
            </div>
          )}

          {error && (
            <div
              id="result-error"
              className="error-message"
              style={{ marginTop: "0.8rem" }}
            >
              {error}
            </div>
          )}
        </div>

        <button
          type="button"
          id="btn-new"
          className="btn-secondary"
          style={{ marginTop: "1.5rem" }}
          onClick={() => openNewRunModal()}
        >
          Start New Run
        </button>
      </div>
    </div>
  );
}
