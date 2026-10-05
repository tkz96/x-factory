// src/frontend/components/ModalContainer.tsx — Global modal portal mount point (XFM-46).

import "./ModalContainer.css";

import { WizardModal } from "../wizard/WizardModal.js";
import { NewRunModal } from "./modals/NewRunModal.js";

export function ModalContainer() {
  return (
    <div id="modal-container">
      <NewRunModal />
      <WizardModal />
    </div>
  );
}
