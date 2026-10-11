// src/frontend/wizard/WizardModal.tsx — The add-project assistant (#268, spec
// #241).
//
// This module is the mount point and nothing else: it decides whether the
// assistant is open, gives it the wizard's state (through `WizardProvider`) and
// hands the sheet the step the state is on. The chrome lives in `WizardSheet`,
// each step's body in `steps/`. The created project is the sheet's terminal
// state: the Review step reports it, and the sheet shows success instead of the
// step it came from.

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "../../shared/types.js";
import { useModal } from "../context/ModalContext.js";
import { useProviderDescriptors } from "../hooks/useProviderDescriptors.js";
import { useWizard, WizardProvider } from "./state/wizardContext.js";
import { ConnectStep } from "./steps/ConnectStep.js";
import { InspectionStep } from "./steps/InspectionStep.js";
import { RepositoriesStep } from "./steps/RepositoriesStep.js";
import { RepositoryStep } from "./steps/RepositoryStep.js";
import { ReviewStep } from "./steps/ReviewStep.js";
import { SuccessStep } from "./steps/SuccessStep.js";
import { WizardSheet } from "./WizardSheet.js";

function WizardContent() {
  const { closeOnboardingModal } = useModal();
  const { state } = useWizard();
  const navigate = useNavigate();
  const [createdProject, setCreatedProject] = useState<Project | null>(null);

  const openCreatedProject = () => {
    if (createdProject === null) return;
    navigate(`/projects/${createdProject.id}`);
    closeOnboardingModal();
  };

  const renderActiveStep = () => {
    switch (state.step) {
      case 1:
        return <RepositoryStep />;
      case 2:
        return <ConnectStep />;
      case 3:
        return <RepositoriesStep />;
      case 4:
        return <InspectionStep />;
      case 5:
        return <ReviewStep onSubmit={setCreatedProject} />;
      default:
        return <RepositoryStep />;
    }
  };

  return (
    <WizardSheet
      onClose={closeOnboardingModal}
      success={
        createdProject === null
          ? undefined
          : { project: createdProject, onOpenProject: openCreatedProject }
      }
    >
      {createdProject === null ? (
        renderActiveStep()
      ) : (
        <SuccessStep project={createdProject} />
      )}
    </WizardSheet>
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
