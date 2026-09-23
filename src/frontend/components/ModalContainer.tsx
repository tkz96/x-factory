// src/frontend/components/ModalContainer.tsx — Global modal portal mount point (XFM-46).

import "./ModalContainer.css";

import { NewRunModal } from "./modals/NewRunModal.js";
import { OnboardingWizardModal } from "./modals/OnboardingWizardModal.js";

export function ModalContainer() {
  return (
    <div id="modal-container">
      <NewRunModal />
      <OnboardingWizardModal />
    </div>
  );
}
