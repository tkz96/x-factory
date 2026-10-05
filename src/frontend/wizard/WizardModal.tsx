// src/frontend/wizard/WizardModal.tsx — Thin orchestrator modal for onboarding (spec #126, #142).

import "./WizardModal.css";

import { useEffect } from "react";
import { useModal } from "../context/ModalContext.js";
import { StepNav } from "./shared/StepNav.js";
import { useWizard, WizardProvider } from "./state/wizardContext.js";
import { BasicsStep } from "./steps/BasicsStep.js";
import { ConnectStep } from "./steps/ConnectStep.js";
import { InspectionStep } from "./steps/InspectionStep.js";
import { RepositoriesStep } from "./steps/RepositoriesStep.js";
import { ReviewStep } from "./steps/ReviewStep.js";

function WizardContent() {
  const { closeOnboardingModal } = useModal();
  const { state } = useWizard();

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeOnboardingModal();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [closeOnboardingModal]);

  const renderActiveStep = () => {
    switch (state.step) {
      case 1:
        return <BasicsStep onCancel={closeOnboardingModal} />;
      case 2:
        return <ConnectStep />;
      case 3:
        return <RepositoriesStep />;
      case 4:
        return <InspectionStep />;
      case 5:
        return <ReviewStep onSubmit={closeOnboardingModal} />;
      default:
        return <BasicsStep onCancel={closeOnboardingModal} />;
    }
  };

  return (
    <div className="wizard-modal-overlay" id="onboarding-wizard-modal-overlay">
      <button
        type="button"
        className="wizard-modal-backdrop"
        aria-label="Close dialog"
        onClick={closeOnboardingModal}
        tabIndex={-1}
      />
      <div
        className="wizard-modal-dialog"
        id="onboarding-wizard-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wizard-modal-title"
      >
        <div className="wizard-modal-header">
          <h1 className="wizard-modal-title" id="wizard-modal-title">
            New Project Setup
          </h1>
          <button
            type="button"
            id="btn-wizard-close"
            className="wizard-modal-close-btn"
            aria-label="Close dialog"
            onClick={closeOnboardingModal}
          >
            ×
          </button>
        </div>

        <StepNav />

        <div className="wizard-modal-body">{renderActiveStep()}</div>
      </div>
    </div>
  );
}

export function WizardModal() {
  const { isOnboardingOpen } = useModal();

  if (!isOnboardingOpen) {
    return null;
  }

  return (
    <WizardProvider>
      <WizardContent />
    </WizardProvider>
  );
}
