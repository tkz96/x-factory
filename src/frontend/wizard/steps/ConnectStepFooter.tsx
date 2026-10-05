// src/frontend/wizard/steps/ConnectStepFooter.tsx — Back and Next action buttons for Connect step.

import "./ConnectStep.css";

export interface ConnectStepFooterProps {
  canProceed: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function ConnectStepFooter({
  canProceed,
  onPrev,
  onNext,
}: ConnectStepFooterProps) {
  return (
    <div className="wizard-actions">
      <button
        type="button"
        id="btn-step-2-back"
        className="btn-secondary"
        onClick={onPrev}
      >
        ← Back
      </button>
      <button
        type="button"
        id="btn-step-2-next"
        className="btn-primary"
        disabled={!canProceed}
        onClick={onNext}
      >
        Continue to Repositories →
      </button>
    </div>
  );
}
