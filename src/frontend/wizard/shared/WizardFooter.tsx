// src/frontend/wizard/shared/WizardFooter.tsx — The assistant's action bar: the
// active step's Back and Continue, pinned to the sheet's right edge (#268, spec
// #241 story 114).
//
// The buttons are the control-vocabulary block (#251), never a bare <button>:
// React Aria owns press, keyboard and disabled semantics. Cancel sits to their
// LEFT and belongs to the sheet, not to a step, because it means the same thing
// on every step.

import "./WizardFooter.css";

import { type ReactNode, useContext } from "react";
import { createPortal } from "react-dom";
import { WIZARD_COPY } from "../../components/feedback/copy-map.js";
import { Button } from "../../components/ui/Button.js";
import type { WizardStepNumber } from "../types.js";
import { WizardFooterSlot } from "./footer-slot.js";

export interface WizardFooterProps {
  /** The step these actions belong to; the button ids carry its number. */
  step: WizardStepNumber;
  /** The step's own note beside the buttons (e.g. why Continue is gated). */
  status?: ReactNode;
  onBack?: (() => void) | undefined;
  /** Omit for a terminal step (Review): it submits instead of continuing. */
  onNext?: (() => void) | undefined;
  /** Overrides the primary action's label (Review: "Create Project"). */
  nextLabel?: string | undefined;
  /** Overrides the primary action's id (Review: `btn-step-5-submit`). */
  nextId?: string | undefined;
  isNextDisabled?: boolean | undefined;
  /** True while the step's primary action is in flight. */
  isBusy?: boolean | undefined;
}

export function WizardFooter({
  step,
  status,
  onBack,
  onNext,
  nextLabel = WIZARD_COPY.continue,
  nextId,
  isNextDisabled = false,
  isBusy = false,
}: WizardFooterProps) {
  const slot = useContext(WizardFooterSlot);

  const actions = (
    <>
      {status !== undefined && (
        <div className="wizard-footer-status">{status}</div>
      )}
      <div className="wizard-footer-buttons">
        {onBack !== undefined && (
          <Button
            id={`btn-step-${step}-back`}
            variant="secondary"
            onPress={onBack}
            isDisabled={isBusy}
          >
            {WIZARD_COPY.back}
          </Button>
        )}
        {onNext !== undefined && (
          <Button
            id={nextId ?? `btn-step-${step}-next`}
            variant="primary"
            onPress={onNext}
            isDisabled={isNextDisabled || isBusy}
          >
            {nextLabel}
          </Button>
        )}
      </div>
    </>
  );

  if (slot === undefined) {
    return <div className="wizard-footer-inline">{actions}</div>;
  }
  return slot ? createPortal(actions, slot) : null;
}
