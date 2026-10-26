// src/frontend/wizard/shared/StepProgress.tsx — "Step N of 5" and the progress
// bar that sits under the assistant's title (#268, spec #241 story 113).
//
// The counter and the bar are one reading of the same fact, taken from the ONE
// step list (`WIZARD_STEPS`): the text is the counter, and the bar is the same
// pair exposed as `role="progressbar"` for anyone who cannot see it.

import "./StepProgress.css";

import "./StepProgress.css";

import { WIZARD_COPY } from "../../components/feedback/copy-map.js";
import { WIZARD_STEPS, type WizardStepNumber } from "../types.js";

export function StepProgress({ step }: { step: WizardStepNumber }) {
  const total = WIZARD_STEPS.length;
  const current = WIZARD_STEPS.find((item) => item.stepNumber === step);
  const label = WIZARD_COPY.stepOfTotal(step, total);

  return (
    <div className="wizard-progress">
      <p
        className="wizard-progress-counter text-footnote"
        id="wizard-progress-counter"
        aria-live="polite"
      >
        {label}
      </p>
      <div
        className="wizard-progress-track"
        id="wizard-progress-bar"
        role="progressbar"
        aria-label={WIZARD_COPY.progressLabel}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={`${label}, ${current?.label ?? ""}`.trim()}
        aria-describedby="wizard-progress-counter"
      >
        <div
          className={`wizard-progress-fill wizard-progress-fill--step-${step}`}
        />
      </div>
    </div>
  );
}
