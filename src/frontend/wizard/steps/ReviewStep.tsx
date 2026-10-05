// src/frontend/wizard/steps/ReviewStep.tsx — Step 5: Final review and submission scaffold (spec #126, #130, #142).

import "./ReviewStep.css";

import { ComboSummary } from "../shared/ComboSummary.js";
import { useWizard } from "../state/wizardContext.js";

interface ReviewStepProps {
  onSubmit?: () => void;
}

export function ReviewStep({ onSubmit }: ReviewStepProps) {
  const { state, prevStep } = useWizard();
  const { name, id, workspacePath } = state.basics;

  return (
    <div id="onboard-step-5" className="wizard-step-pane review-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Review Project Setup</h2>
        <p className="wizard-step-subtitle">
          Confirm configuration before finalizing project creation.
        </p>
      </div>

      <ComboSummary />

      <div className="review-summary-card">
        <div className="review-row">
          <span className="review-label">Project Name</span>
          <span className="review-value" id="review-proj-name">
            {name || "Untitled"}
          </span>
        </div>

        <div className="review-row">
          <span className="review-label">Identifier</span>
          <span className="review-value code-font" id="review-proj-id">
            {id || "—"}
          </span>
        </div>

        <div className="review-row">
          <span className="review-label">Workspace Path</span>
          <span className="review-value code-font" id="review-workspace-path">
            {workspacePath || "(Default)"}
          </span>
        </div>
      </div>

      <div className="wizard-actions">
        <button
          type="button"
          id="btn-step-5-back"
          className="btn-secondary"
          onClick={prevStep}
        >
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-5-submit"
          className="btn-primary"
          onClick={onSubmit}
        >
          Create Project
        </button>
      </div>
    </div>
  );
}
