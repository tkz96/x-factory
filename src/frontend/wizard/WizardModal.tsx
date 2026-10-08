// src/frontend/wizard/WizardModal.tsx — Thin orchestrator modal for onboarding (spec #126, #142, #159).
//
// The wizard composes the reusable <Modal> rather than re-implementing dialog
// behaviour. <Modal> owns the backdrop, dialog semantics, dismissal and background
// scroll lock; this component only fills its slots: the title, the step navigation
// (subheader) and the active step (body). Each step puts its actions in the fixed
// footer with <ModalFooter> (#159).

import "./WizardModal.css";

import { Modal } from "../components/Modal.js";
import { useModal } from "../context/ModalContext.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
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
    <Modal
      id="onboarding-wizard-modal"
      title="New Project Setup"
      onClose={closeOnboardingModal}
      className="wizard-modal-dialog"
      closeButtonId="btn-wizard-close"
      subheader={<StepNav />}
    >
      {renderActiveStep()}
    </Modal>
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
