// src/frontend/components/runs/RunReviewSummary.tsx — The Reviewer's review, shown on the decision card at
// the review checkpoint: its summary, its findings (errors first) and each criterion's verdict. The
// verdicts are the Reviewer's judgement, labelled as such, so they are not read as the test results.

import "./RunReviewSummary.css";

import { reviewCriterionStatus } from "../../../shared/review-criterion-status.js";
import type {
  Finding,
  ReviewCriterionStatus,
  ReviewResult,
} from "../../../shared/types.js";
import { Badge, type BadgeTone } from "../ui/Badge.js";

const SEVERITY: Record<
  Finding["severity"],
  { rank: number; label: string; tone: BadgeTone }
> = {
  error: { rank: 0, label: "Error", tone: "error" },
  warning: { rank: 1, label: "Warning", tone: "warning" },
  info: { rank: 2, label: "Info", tone: "neutral" },
};

const VERDICT: Record<
  ReviewCriterionStatus,
  { text: string; className: string }
> = {
  pass: { text: "Pass", className: "run-review-verdict--pass" },
  fail: { text: "Fail", className: "run-review-verdict--fail" },
  not_assessed: {
    text: "Not assessed",
    className: "run-review-verdict--muted",
  },
};

export interface RunReviewSummaryProps {
  review: ReviewResult;
}

export function RunReviewSummary({ review }: RunReviewSummaryProps) {
  // Errors first; the sort is stable, so findings keep the Reviewer's order within a severity.
  const findings = [...review.findings].sort(
    (a, b) => SEVERITY[a.severity].rank - SEVERITY[b.severity].rank,
  );

  return (
    <section className="run-review text-callout" aria-label="Review">
      <p
        className={
          review.passed
            ? "run-review-summary run-review-summary--pass"
            : "run-review-summary run-review-summary--fail"
        }
      >
        {review.summary}
      </p>

      {findings.length > 0 && (
        <div className="run-review-group">
          <h3 className="run-review-caption text-headline">Findings</h3>
          <ul className="run-review-list">
            {findings.map((finding) => (
              <li key={finding.message} className="run-review-finding">
                <Badge tone={SEVERITY[finding.severity].tone}>
                  {SEVERITY[finding.severity].label}
                </Badge>
                <span className="run-review-message">{finding.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {review.criteriaChecked.length > 0 && (
        <div className="run-review-group">
          <h3 className="run-review-caption text-headline">
            Reviewer judgement
          </h3>
          <ul className="run-review-list">
            {review.criteriaChecked.map((check) => {
              const verdict = VERDICT[reviewCriterionStatus(check)];
              return (
                <li key={check.criterion} className="run-review-criterion">
                  <div className="run-review-criterion-row">
                    <span className="run-review-message">
                      {check.criterion}
                    </span>
                    <span className={`run-review-verdict ${verdict.className}`}>
                      {verdict.text}
                    </span>
                  </div>
                  {check.notes && (
                    <p className="run-review-notes">{check.notes}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
