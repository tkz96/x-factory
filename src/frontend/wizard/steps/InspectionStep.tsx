// src/frontend/wizard/steps/InspectionStep.tsx — Step 4: the git identity the
// agent will commit with (spec #133, #146).
//
// The identity is read from each selected repository's directory through the
// api-client, resolved by the same git CLI the executor's worktree uses. Every
// async state is rendered through the feedback primitives: the step derives with
// `deriveAsyncState` and hands the result to `AsyncRegion`, and builds no
// loading or error markup by hand.
//
// Provider-agnostic: the step knows a selection of repositories and a directory
// to read a git configuration in, never a provider id or field name.

import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import { INSPECTION_COPY } from "../../components/feedback/copy-map.js";
import { FeedbackBanner } from "../../components/feedback/FeedbackBanner.js";
import { useWizard } from "../state/wizardContext.js";
import { useInspection } from "./useInspection.js";
import "./InspectionStep.css";

export function InspectionStep() {
  const { nextStep, prevStep } = useWizard();
  const {
    derived,
    status,
    unresolvedRepoLabels,
    inspectAgain,
    isEmptySelection,
  } = useInspection();

  const identity = status.record?.gitIdentity;
  const inspectedPath = status.record?.inspectedPath;

  return (
    <div id="onboard-step-4" className="wizard-step-pane inspection-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">{INSPECTION_COPY.title}</h2>
        <p className="wizard-step-subtitle">{INSPECTION_COPY.subtitle}</p>
      </div>

      <div id="inspection-region" className="inspection-region">
        <AsyncRegion
          derived={derived}
          onRetry={inspectAgain}
          emptyCopy={
            isEmptySelection
              ? INSPECTION_COPY.emptyNoSelection
              : INSPECTION_COPY.emptyNoPath
          }
          failedParts={unresolvedRepoLabels.map(INSPECTION_COPY.unresolvedRepo)}
        >
          {identity ? (
            <dl className="inspection-identity" id="inspection-identity">
              <div className="inspection-identity-row">
                <dt className="inspection-identity-label">
                  {INSPECTION_COPY.nameLabel}
                </dt>
                <dd
                  className="inspection-identity-value"
                  id="inspection-identity-name"
                >
                  {identity.name}
                </dd>
              </div>
              <div className="inspection-identity-row">
                <dt className="inspection-identity-label">
                  {INSPECTION_COPY.emailLabel}
                </dt>
                <dd
                  className="inspection-identity-value code-font"
                  id="inspection-identity-email"
                >
                  {identity.email}
                </dd>
              </div>
              {inspectedPath !== undefined && (
                <div className="inspection-identity-row">
                  <dt className="inspection-identity-label">
                    {INSPECTION_COPY.pathLabel}
                  </dt>
                  <dd
                    className="inspection-identity-value code-font"
                    id="inspection-identity-path"
                  >
                    {inspectedPath}
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            status.record !== null && (
              <div id="inspection-identity-missing">
                <FeedbackBanner
                  tone="error"
                  message={INSPECTION_COPY.identityMissing(inspectedPath ?? "")}
                  onRetry={inspectAgain}
                />
              </div>
            )
          )}
        </AsyncRegion>
      </div>

      <div className="modal-actions">
        <button
          type="button"
          id="btn-step-4-back"
          className="btn-secondary"
          onClick={prevStep}
        >
          ← {INSPECTION_COPY.previous}
        </button>
        <button
          type="button"
          id="btn-step-4-next"
          className="btn-primary"
          onClick={nextStep}
        >
          {INSPECTION_COPY.next} →
        </button>
      </div>
    </div>
  );
}
