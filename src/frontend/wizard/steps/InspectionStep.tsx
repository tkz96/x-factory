// src/frontend/wizard/steps/InspectionStep.tsx — Step 4: Tooling & Git Identity Inspection scaffold (spec #126, #130, #142).

import "./InspectionStep.css";

import { useWizard } from "../state/wizardContext.js";

export function InspectionStep() {
  const { nextStep, prevStep } = useWizard();

  return (
    <div id="onboard-step-4" className="wizard-step-pane inspection-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Tooling &amp; Identity Inspection</h2>
        <p className="wizard-step-subtitle">
          Verify local git identity and readiness across selected repositories.
        </p>
      </div>

      <div className="inspection-placeholder">
        <p>Tooling and git identity verification will display here.</p>
      </div>

      <div className="wizard-actions">
        <button
          type="button"
          id="btn-step-4-back"
          className="btn-secondary"
          onClick={prevStep}
        >
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-4-next"
          className="btn-primary"
          onClick={nextStep}
        >
          Continue to Review →
        </button>
      </div>
    </div>
  );
}
