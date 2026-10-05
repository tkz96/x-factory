// src/frontend/wizard/shared/StepNav.tsx — Five-step navigation component (spec #126, #130, #142).

import "./StepNav.css";

import { useWizard } from "../state/wizardContext.js";
import { WIZARD_STEPS, type WizardStepId } from "../types.js";

export function StepNav() {
  const { state, goToStep, isStepAccessible } = useWizard();

  return (
    <nav className="wizard-step-nav" aria-label="Onboarding Wizard Steps">
      {WIZARD_STEPS.map((stepItem, index) => {
        const stepId: WizardStepId = stepItem.id;
        const isActive = state.step === stepItem.stepNumber;
        const isCompleted = state.step > stepItem.stepNumber;
        const isAccessible =
          isStepAccessible(stepItem.stepNumber) &&
          stepItem.stepNumber <= state.step;

        return (
          <div key={stepId} className="flex-1 flex items-center">
            <button
              type="button"
              id={`step-nav-${stepId}`}
              className={`wizard-step-button ${isActive ? "active" : ""} ${
                isCompleted ? "completed" : ""
              }`}
              disabled={!isAccessible}
              onClick={() => goToStep(stepItem.stepNumber)}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="wizard-step-number">{stepItem.stepNumber}</span>
              <span className="wizard-step-label">{stepItem.label}</span>
            </button>
            {index < WIZARD_STEPS.length - 1 && (
              <div className="wizard-step-divider" aria-hidden="true" />
            )}
          </div>
        );
      })}
    </nav>
  );
}
