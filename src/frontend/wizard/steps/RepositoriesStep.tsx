// src/frontend/wizard/steps/RepositoriesStep.tsx — Step 3: Repositories discovery & selection scaffold (spec #126, #130, #142).

import "./RepositoriesStep.css";

import { useWizard } from "../state/wizardContext.js";

export function RepositoriesStep() {
  const { nextStep, prevStep } = useWizard();

  return (
    <div
      id="onboard-step-3"
      className="wizard-step-pane repositories-step-pane"
    >
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Select Repositories</h2>
        <p className="wizard-step-subtitle">
          Repositories discovered from your Git Host provider will appear here.
        </p>
      </div>

      <div className="repositories-list-placeholder">
        <p>Repository selection will be populated via git-host discovery.</p>
      </div>

      <div className="wizard-actions">
        <button
          type="button"
          id="btn-step-3-back"
          className="btn-secondary"
          onClick={prevStep}
        >
          ← Back
        </button>
        <button
          type="button"
          id="btn-step-3-next"
          className="btn-primary"
          onClick={nextStep}
        >
          Continue to Inspection →
        </button>
      </div>
    </div>
  );
}
