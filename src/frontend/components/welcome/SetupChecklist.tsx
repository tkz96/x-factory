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
import { Button } from "../ui/Button.js";
import { ListGroup, ListGroupRow } from "../ui/ListGroup.js";

/**
 * The step's leading mark: a filled tick when it is done, a ring while not. It
 * is decorative — the state word is its sibling, so a screen reader hears it
 * (S-09: the capsule badge that used to repeat it is gone).
 */
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

/**
 * How loudly a step's action is drawn. Only the first step still to do gets the
 * primary fill; the other open steps are secondary, and a finished step's action
 * is quiet, so it stays reachable without competing with the step that needs
 * doing.
 */
type ActionWeight = "primary" | "secondary" | "quiet";

/** The one action that finishes a step. */
function StepAction({
  stepId,
  done,
  weight,
  openAddProject,
}: {
  stepId: SetupStepId;
  done: boolean;
  weight: ActionWeight;
  openAddProject: () => void;
}) {
  if (stepId === "project") {
    return (
      <Button
        variant={weight}
        size="sm"
        icon="icon-plus"
        onPress={openAddProject}
      >
        {done
          ? WELCOME_COPY.stepAction.projectAgain
          : WELCOME_COPY.stepAction.project}
      </Button>
    );
  }
  const to =
    stepId === "model"
      ? WELCOME_COPY.stepPath.model
      : WELCOME_COPY.stepPath.run;
  return (
    <Link className={`ui-button ui-button--${weight} ui-button--sm`} to={to}>
      {WELCOME_COPY.stepAction[stepId]}
    </Link>
  );
}

export interface SetupChecklistProps {
  /** From `deriveSetupChecklist` — real state, never a guess (#269). */
  checklist: SetupChecklistModel;
  /** "I'll set up later": leaves the welcome while steps are still to do. */
  onSetUpLater: () => void;
}

export function SetupChecklist({
  checklist,
  onSetUpLater,
}: SetupChecklistProps) {
  const { openOnboardingModal } = useModal();
  // The first step still to do is the one the screen asks for: the only primary
  // action. Once every step is done there is none.
  const nextStepId = checklist.steps.find((step) => !step.done)?.id;

  return (
    <div className="welcome-checklist">
      <div className="welcome-progress-row">
        <p className="welcome-progress">
          {WELCOME_COPY.progress(checklist.doneCount, checklist.steps.length)}
        </p>
        {!checklist.complete && (
          <Button variant="quiet" size="sm" onPress={onSetUpLater}>
            {WELCOME_COPY.setUpLater}
          </Button>
        )}
      </div>

      {/* One inset group: a row per step — the ring leads, the title and
          body carry the words, and the one action trails. */}
      <ListGroup>
        {checklist.steps.map((step) => (
          <ListGroupRow
            key={step.id}
            titleHeadingLevel={2}
            title={WELCOME_COPY.stepTitle[step.id]}
            leading={
              <>
                <StepMark done={step.done} />
                {step.done && (
                  <span className="sr-only">{WELCOME_COPY.done}</span>
                )}
              </>
            }
            subtitle={
              <>
                <span className="setup-step-body">
                  {WELCOME_COPY.stepBody[step.id]}
                </span>
                {step.gaps.length > 0 && (
                  <span className="setup-step-gap">
                    {step.gaps.map((gap) => WELCOME_COPY.gap[gap]).join(" ")}
                  </span>
                )}
              </>
            }
            trailing={
              <StepAction
                stepId={step.id}
                done={step.done}
                weight={
                  step.done
                    ? "quiet"
                    : step.id === nextStepId
                      ? "primary"
                      : "secondary"
                }
                openAddProject={openOnboardingModal}
              />
            }
          />
        ))}
      </ListGroup>
    </div>
  );
}
