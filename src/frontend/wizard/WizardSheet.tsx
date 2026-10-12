// src/frontend/wizard/WizardSheet.tsx — The add-project assistant sheet (#268,
// spec #241 stories 112–118).
//
// The chrome of the assistant lives here and nowhere else: the title, the
// "Step N of 5" counter and its progress bar, and the action bar with Cancel on
// the left and the step's Back and Continue on the right. A step supplies only
// its body and its two actions (`WizardFooter`), so every step looks and behaves
// the same and no step has to know how the assistant is framed.
//
// It composes the #250 Sheet overlay (which owns focus, inertness, Escape and
// scroll lock) and the #251 Button block. Position `center` is the sheet that
// takes the height of its content: a short step never leaves empty space.

import "./WizardSheet.css";
import "./shared/StepChrome.css";

import { type ReactNode, useCallback, useMemo, useState } from "react";
import type { Project } from "../../shared/types.js";
import { WIZARD_COPY } from "../components/feedback/copy-map.js";
import {
  DialogBody,
  DialogCloseButton,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/overlays/Dialog.js";
import { Sheet } from "../components/overlays/Sheet.js";
import { Button } from "../components/ui/Button.js";
import { WizardFooterSlot } from "./shared/footer-slot.js";
import { StepProgress } from "./shared/StepProgress.js";
import { wizardHasProgress } from "./state/draftRules.js";
import { WizardUrlIntakeProvider } from "./state/urlIntake.js";
import { useWizard } from "./state/wizardContext.js";
import { clearWizardDraft, saveWizardDraft } from "./storage.js";
import { WizardDismissPrompt } from "./WizardDismissPrompt.js";

export interface WizardSuccess {
  project: Project;
  onOpenProject: () => void;
}

export interface WizardSheetProps {
  /** The sheet stays mounted while it is false, so it can play its exit (#250). */
  isOpen: boolean;
  onClose: () => void;
  /** Set once the project exists: the assistant's terminal state. */
  success?: WizardSuccess | undefined;
  children: ReactNode;
}

export function WizardSheet({
  isOpen,
  onClose,
  success,
  children,
}: WizardSheetProps) {
  const { state, descriptors } = useWizard();
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);

  // Which way the last step change went (O3): forward slides in from the right,
  // Back from the left. Kept as a pair so the direction is right on the frame
  // the new pane mounts, never a frame late.
  const [nav, setNav] = useState<{ step: number; direction: "forward" | "back" }>(
    { step: state.step, direction: "forward" },
  );
  if (nav.step !== state.step) {
    setNav({
      step: state.step,
      direction: state.step < nav.step ? "back" : "forward",
    });
  }

  // Derived from the state the sheet is showing, never stored (#268 story 116):
  // there is work to lose exactly when the draft holds something.
  const progress = useMemo(() => wizardHasProgress(state), [state]);

  const requestClose = useCallback(() => {
    if (progress) {
      setPromptOpen(true);
      return;
    }
    onClose();
  }, [progress, onClose]);

  const saveDraft = useCallback(() => {
    saveWizardDraft(state, descriptors);
    setPromptOpen(false);
    onClose();
  }, [state, descriptors, onClose]);

  const discard = useCallback(() => {
    clearWizardDraft();
    setPromptOpen(false);
    onClose();
  }, [onClose]);

  return (
    <>
      <Sheet
        isOpen={isOpen}
        onClose={requestClose}
        id="onboarding-wizard-modal"
        position="center"
        title={WIZARD_COPY.title}
        className="wizard-sheet"
      >
        <DialogHeader className="wizard-sheet-header">
          <DialogTitle>{WIZARD_COPY.title}</DialogTitle>
          <DialogCloseButton id="btn-wizard-close" onClose={requestClose} />
        </DialogHeader>

        {success === undefined && <StepProgress step={state.step} />}

        <DialogBody className="wizard-sheet-body">
          <WizardUrlIntakeProvider>
            <WizardFooterSlot.Provider value={actionsSlot}>
              {/* Keyed on the step: a new pane mounts per step and plays its
                  own arrival (O3). */}
              <div
                key={state.step}
                className="wizard-step-swap"
                data-direction={nav.direction}
              >
                {children}
              </div>
            </WizardFooterSlot.Provider>
          </WizardUrlIntakeProvider>
        </DialogBody>

        <DialogFooter className="wizard-sheet-footer">
          {success === undefined && (
            <Button
              id="btn-wizard-cancel"
              variant="quiet"
              onPress={requestClose}
            >
              {WIZARD_COPY.cancel}
            </Button>
          )}
          {success === undefined ? (
            <div className="wizard-sheet-actions" ref={setActionsSlot} />
          ) : (
            <div className="wizard-sheet-actions">
              <Button
                id="btn-wizard-done"
                variant="secondary"
                onPress={onClose}
              >
                {WIZARD_COPY.done}
              </Button>
              <Button
                id="btn-open-project"
                variant="primary"
                onPress={success.onOpenProject}
              >
                {WIZARD_COPY.openProject}
              </Button>
            </div>
          )}
        </DialogFooter>
      </Sheet>

      <WizardDismissPrompt
        isOpen={promptOpen}
        onSaveDraft={saveDraft}
        onDiscard={discard}
        onCancel={() => setPromptOpen(false)}
      />
    </>
  );
}
