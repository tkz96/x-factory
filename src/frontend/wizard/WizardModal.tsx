// src/frontend/wizard/WizardModal.tsx — Thin orchestrator modal for onboarding (spec #126, #142, #159).
//
// The wizard composes the application's reusable modal structure (.modal-backdrop /
// .modal-dialog / .modal-header / .modal-body) rather than a wizard-specific dialog
// abstraction. The shared modal supplies the structural guarantees — constrained
// viewport height, internal scrolling body, persistent header, responsive padding and
// accessible dialog semantics — while this component only supplies wizard content and
// navigation through normal React composition (#159).

import "./WizardModal.css";

import { useEffect } from "react";
import { useModal } from "../context/ModalContext.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useScrollLock } from "../hooks/useScrollLock.js";
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

  // This component only mounts while the wizard is open, so the background is
  // scroll-locked for its whole lifetime and released when it closes (#159).
  useScrollLock(true);

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
    // biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click dismisses the dialog (same pattern as the shared modals)
    <div
      className="modal-backdrop"
      id="onboarding-wizard-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wizard-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeOnboardingModal();
      }}
    >
      <div
        className="modal-dialog wizard-modal-dialog"
        id="onboarding-wizard-modal"
      >
        <div className="modal-header">
          <h2 id="wizard-modal-title">New Project Setup</h2>
          <button
            type="button"
            id="btn-wizard-close"
            className="btn-close"
            aria-label="Close dialog"
            onClick={closeOnboardingModal}
          >
            ×
          </button>
        </div>

        <StepNav />

        <div className="modal-body">{renderActiveStep()}</div>
      </div>
    </div>
  );
}

export function WizardModal() {
  const { isOnboardingOpen } = useModal();
  const { data: descriptors } = useProviderDescriptors();

  if (!isOnboardingOpen) {
    return null;
  }

  return (
    <WizardProvider descriptors={descriptors}>
      <WizardContent />
    </WizardProvider>
  );
}
