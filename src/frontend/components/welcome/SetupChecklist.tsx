// src/frontend/components/welcome/SetupChecklist.tsx — The welcome's three
// steps (#269, spec #241 stories 109–111).
//
// Presentation only: `deriveSetupChecklist` decides what is done from real
// state and the component renders that state word, the gaps that are left and
// the one action that takes the user to where the step is finished. The
// add-project step opens the assistant sheet (#268) through the modal context;
// the model step and the run step link to the screen that owns the work
// (Settings › Models, Tickets), which is how those steps tick themselves.

import "./SetupChecklist.css";

import { Link } from "react-router-dom";
import { useModal } from "../../context/ModalContext.js";
import type {
  SetupChecklist as SetupChecklistModel,
  SetupStepId,
} from "../../lib/setup-checklist.js";
import { WELCOME_COPY } from "../feedback/copy-map.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";

/** The step's leading mark: a filled tick when it is done, a ring while not. */
function StepMark({ done }: { done: boolean }) {
  return (
    <span
      className="setup-step-mark"
      data-done={done ? "true" : "false"}
      aria-hidden="true"
    >
      {done && (
        <svg className="icon icon-sm" aria-hidden="true">
          <use href="/assets/icons/sprite.svg#icon-check" />
        </svg>
      )}
    </span>
  );
}

/** The one action that finishes a step. */
function StepAction({
  stepId,
  openAddProject,
}: {
  stepId: SetupStepId;
  openAddProject: () => void;
}) {
  if (stepId === "project") {
    return (
      <Button
        variant="primary"
        size="sm"
        icon="icon-plus"
        onPress={openAddProject}
      >
        {WELCOME_COPY.stepAction.project}
      </Button>
    );
  }
  const to =
    stepId === "model"
      ? WELCOME_COPY.stepPath.model
      : WELCOME_COPY.stepPath.run;
  return (
    <Link className="btn-secondary btn-sm" to={to}>
      {WELCOME_COPY.stepAction[stepId]}
    </Link>
  );
}

export interface SetupChecklistProps {
  /** From `deriveSetupChecklist` — real state, never a guess (#269). */
  checklist: SetupChecklistModel;
}

export function SetupChecklist({ checklist }: SetupChecklistProps) {
  const { openOnboardingModal } = useModal();

  return (
    <div className="welcome-checklist">
      <p className="welcome-progress">
        {WELCOME_COPY.progress(checklist.doneCount, checklist.steps.length)}
      </p>

      <ol className="setup-steps">
        {checklist.steps.map((step) => (
          <li key={step.id} className="setup-step">
            <div className="setup-step-head">
              <StepMark done={step.done} />
              <h2 className="setup-step-title">
                {WELCOME_COPY.stepTitle[step.id]}
              </h2>
              <Badge tone={step.done ? "success" : "neutral"}>
                {step.done ? WELCOME_COPY.done : WELCOME_COPY.todo}
              </Badge>
            </div>
            <p className="setup-step-body">{WELCOME_COPY.stepBody[step.id]}</p>
            {step.gaps.length > 0 && (
              <p className="setup-step-gap">
                {step.gaps.map((gap) => WELCOME_COPY.gap[gap]).join(" ")}
              </p>
            )}
            <div className="setup-step-action">
              <StepAction
                stepId={step.id}
                openAddProject={openOnboardingModal}
              />
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
