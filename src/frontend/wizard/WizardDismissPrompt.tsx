// src/frontend/wizard/WizardDismissPrompt.tsx — What dismissing an unfinished
// assistant asks (#268, spec #241 story 116).
//
// Esc, the sheet's Cancel and a backdrop click all mean "I am done with this
// sheet". When there is work to lose, none of them throws it away silently:
// this prompt offers Save Draft, Discard and Cancel, and Cancel is the safe
// default — the sheet and every value in it stay exactly as they were.

import "./WizardDismissPrompt.css";

import { WIZARD_COPY } from "../components/feedback/copy-map.js";
import { Dialog } from "../components/overlays/Dialog.js";
import { Button } from "../components/ui/Button.js";

export interface WizardDismissPromptProps {
  isOpen: boolean;
  onSaveDraft: () => void;
  onDiscard: () => void;
  /** Stay in the assistant; nothing is saved or dropped. */
  onCancel: () => void;
}

export function WizardDismissPrompt({
  isOpen,
  onSaveDraft,
  onDiscard,
  onCancel,
}: WizardDismissPromptProps) {
  return (
    <Dialog
      isOpen={isOpen}
      onClose={onCancel}
      id="wizard-dismiss-prompt"
      role="alertdialog"
      title={WIZARD_COPY.dismissTitle}
      className="xf-dialog-window wizard-dismiss-dialog"
    >
      <h2 id="wizard-dismiss-prompt-title" className="wizard-dismiss-title">
        {WIZARD_COPY.dismissTitle}
      </h2>
      <p className="wizard-dismiss-body">{WIZARD_COPY.dismissBody}</p>
      <div className="wizard-dismiss-actions">
        <Button
          id="btn-wizard-discard"
          variant="danger"
          onPress={onDiscard}
          className="wizard-dismiss-discard"
        >
          {WIZARD_COPY.discard}
        </Button>
        <Button
          id="btn-wizard-keep-editing"
          variant="secondary"
          onPress={onCancel}
        >
          {WIZARD_COPY.keepEditing}
        </Button>
        <Button
          id="btn-wizard-save-draft"
          variant="primary"
          onPress={onSaveDraft}
        >
          {WIZARD_COPY.saveDraft}
        </Button>
      </div>
    </Dialog>
  );
}
