// src/frontend/wizard/steps/SuccessStep.tsx — The assistant's terminal state
// (#268, spec #241 story 118).
//
// Reached the moment the project exists, in place of the Review step: the
// wizard has nothing left to ask. "Open Project" is the sheet's primary action
// (rendered in its footer) and this body names what was created, so the reader
// knows the project is theirs before they go anywhere.

import "./SuccessStep.css";

import type { Project } from "../../../shared/types.js";
import { WIZARD_COPY } from "../../components/feedback/copy-map.js";

export function SuccessStep({ project }: { project: Project }) {
  return (
    <div id="onboard-success" className="wizard-step-pane success-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title text-headline">
          {WIZARD_COPY.successTitle}
        </h2>
        <p className="wizard-step-subtitle text-callout">
          {WIZARD_COPY.successBody(project.name)}
        </p>
      </div>

      <dl className="success-step-summary" id="success-step-summary">
        <div className="success-step-row">
          <dt className="success-step-label text-subhead">Project</dt>
          <dd
            className="success-step-value text-callout"
            id="success-step-project-name"
          >
            {project.name}
          </dd>
        </div>
        <div className="success-step-row">
          <dt className="success-step-label text-subhead">Identifier</dt>
          <dd
            className="success-step-value success-step-value--code text-callout"
            id="success-step-project-id"
          >
            {project.id}
          </dd>
        </div>
      </dl>
    </div>
  );
}
