// src/frontend/wizard/steps/InspectionStep.tsx — Step 4: the git identity this
// PROJECT commits with (spec #133, #146).
//
// The Name and Email fields are pre-filled from the git configuration read in
// each selected repository's directory (the "Read from" note names the source),
// and the user may edit them. The values become the project's `gitIdentity` on
// create; every commit X-Factory makes for the project uses them. Nothing is
// written to any git config file, so a user's other repositories keep theirs.
// Every async state is rendered through the feedback primitives: the step
// derives with `deriveAsyncState` and hands the result to `AsyncRegion`.
//
// Provider-agnostic: the step knows a selection of repositories and a directory
// to read a git configuration in, never a provider id or field name.

import { useState } from "react";
import {
  hasControlCharacters,
  isValidEmail,
} from "../../../shared/validation.js";
import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import { INSPECTION_COPY } from "../../components/feedback/copy-map.js";
import { FeedbackBanner } from "../../components/feedback/FeedbackBanner.js";
import { FieldFeedback } from "../../components/feedback/FieldFeedback.js";
import { WizardFooter } from "../shared/WizardFooter.js";
import { useWizard } from "../state/wizardContext.js";
import { useInspection } from "./useInspection.js";
import "./InspectionStep.css";

/** What the author name is wrong about, or null while it is fine. */
function nameProblem(value: string): string | null {
  if (value !== "" && hasControlCharacters(value)) {
    return INSPECTION_COPY.nameInvalidError;
  }
  return value.trim() === "" ? INSPECTION_COPY.nameRequiredError : null;
}

/** What the author email is wrong about, or null while it is fine. */
function emailProblem(value: string): string | null {
  if (value !== "" && !isValidEmail(value)) {
    return INSPECTION_COPY.emailInvalidError;
  }
  return value.trim() === "" ? INSPECTION_COPY.emailRequiredError : null;
}

export function InspectionStep() {
  const { state, nextStep, prevStep } = useWizard();
  const { derived, status, inspectAgain, setProjectIdentity } = useInspection();

  const { workspacePath } = state.basics;
  const inspectedPath = status.record?.inspectedPath ?? workspacePath;
  const chosen = status.record?.gitIdentity;
  const read = status.record?.readIdentity;
  const name = chosen?.name ?? "";
  const email = chosen?.email ?? "";

  // The problems as of the last check point: the field was left (#268). Typing
  // never re-checks: it clears the field's own problem, so an error cannot
  // interrupt a half-written name or address.
  const [errors, setErrors] = useState<{
    name: string | null;
    email: string | null;
  }>({ name: null, email: null });

  return (
    <div id="onboard-step-4" className="wizard-step-pane inspection-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title text-headline">
          {INSPECTION_COPY.title}
        </h2>
        <p className="wizard-step-subtitle text-callout">
          {INSPECTION_COPY.subtitle}
        </p>
      </div>

      <div id="inspection-region" className="inspection-region">
        <AsyncRegion
          derived={derived}
          onRetry={inspectAgain}
          emptyCopy={INSPECTION_COPY.emptyNoSelection}
        >
          {status.record !== null && (
            <form
              className="git-identity-form"
              id="project-git-identity-form"
              onSubmit={(e) => e.preventDefault()}
              noValidate
            >
              <p
                className="git-identity-source text-subhead"
                id="inspection-source"
              >
                {read
                  ? INSPECTION_COPY.readFrom(inspectedPath)
                  : INSPECTION_COPY.identityMissing(inspectedPath)}
              </p>

              <div className="git-identity-fields">
                <div className="form-group">
                  <label
                    htmlFor="git-identity-name-input"
                    className="form-label"
                  >
                    {INSPECTION_COPY.authorNameLabel}
                  </label>
                  <input
                    id="git-identity-name-input"
                    type="text"
                    className="form-input"
                    placeholder={INSPECTION_COPY.authorNamePlaceholder}
                    value={name}
                    onChange={(e) => {
                      setProjectIdentity({ name: e.target.value, email });
                      setErrors((c) =>
                        c.name === null ? c : { ...c, name: null },
                      );
                    }}
                    onBlur={() =>
                      setErrors((c) => ({ ...c, name: nameProblem(name) }))
                    }
                    aria-invalid={errors.name ? "true" : undefined}
                    aria-describedby={
                      errors.name ? "git-identity-name-error" : undefined
                    }
                    required
                  />
                  {errors.name && (
                    <FieldFeedback
                      id="git-identity-name-error"
                      state="invalid"
                      message={errors.name}
                    />
                  )}
                </div>

                <div className="form-group">
                  <label
                    htmlFor="git-identity-email-input"
                    className="form-label"
                  >
                    {INSPECTION_COPY.authorEmailLabel}
                  </label>
                  <input
                    id="git-identity-email-input"
                    type="email"
                    className="form-input code-font"
                    placeholder={INSPECTION_COPY.authorEmailPlaceholder}
                    value={email}
                    onChange={(e) => {
                      setProjectIdentity({ name, email: e.target.value });
                      setErrors((c) =>
                        c.email === null ? c : { ...c, email: null },
                      );
                    }}
                    onBlur={() =>
                      setErrors((c) => ({ ...c, email: emailProblem(email) }))
                    }
                    aria-invalid={errors.email ? "true" : undefined}
                    aria-describedby={
                      errors.email ? "git-identity-email-error" : undefined
                    }
                    required
                  />
                  {errors.email && (
                    <FieldFeedback
                      id="git-identity-email-error"
                      state="invalid"
                      message={errors.email}
                    />
                  )}
                </div>
              </div>

              <p className="git-identity-hint text-subhead">
                {INSPECTION_COPY.projectHint}
              </p>
              {!read && (
                <FeedbackBanner
                  tone="warning"
                  message={INSPECTION_COPY.identityExplanation}
                />
              )}
            </form>
          )}
        </AsyncRegion>
      </div>

      <WizardFooter step={4} onBack={prevStep} onNext={nextStep} />
    </div>
  );
}
