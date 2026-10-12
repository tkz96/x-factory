// src/frontend/components/ModalContainer.tsx — Global modal portal mount point (XFM-46).
//
// New Run and the add-project assistant are windows of the one Sheet/Dialog
// structure, so there is no modal container stylesheet left to load:
// each window brings the shared surface and stays mounted while it closes.

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
