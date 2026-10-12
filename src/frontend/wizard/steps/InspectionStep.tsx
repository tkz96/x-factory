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

import { type FormEvent, useEffect, useState } from "react";
import type { GitIdentityScope } from "../../../shared/types.js";
import {
  hasControlCharacters,
  isValidEmail,
} from "../../../shared/validation.js";
import { AsyncRegion } from "../../components/feedback/AsyncRegion.js";
import { INSPECTION_COPY } from "../../components/feedback/copy-map.js";
import { FeedbackBanner } from "../../components/feedback/FeedbackBanner.js";
import { FieldFeedback } from "../../components/feedback/FieldFeedback.js";
import { Button } from "../../components/ui/Button.js";
import { SegmentedControl } from "../../components/ui/SegmentedControl.js";
import { ApiError } from "../../lib/api-client.js";
import { WizardFooter } from "../shared/WizardFooter.js";
import { useWizard } from "../state/wizardContext.js";
import { PartialConfigureError, useInspection } from "./useInspection.js";
import "./InspectionStep.css";

function resolveConfigureErrorMessage(err: unknown): string {
  if (err instanceof PartialConfigureError) {
    return INSPECTION_COPY.configurePartialError(
      err.configuredPaths,
      err.failedPaths,
    );
  }
  const code =
    err instanceof ApiError
      ? err.code
      : err instanceof Error &&
          "code" in err &&
          typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;

  switch (code) {
    case "DIRECTORY_MISSING":
      return INSPECTION_COPY.directoryMissingError;
    case "NOT_A_REPOSITORY":
      return INSPECTION_COPY.notARepositoryError;
    case "NOT_REPOSITORY_ROOT":
      return INSPECTION_COPY.notRepositoryRootError;
    case "GIT_CONFIG_WRITE_FAILED":
      return INSPECTION_COPY.configureServerError;
    default:
      return INSPECTION_COPY.configureServerError;
  }
}

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
  const {
    derived,
    status,
    unresolvedRepoLabels,
    inspectAgain,
    isEmptySelection,
    configureIdentity,
    isConfiguring,
    configureError,
  } = useInspection();

  const { workspacePath } = state.basics;
  const primaryPath = status.record?.inspectedPath ?? workspacePath;
  const inspectedPath = primaryPath;
  const unresolvedPaths = status.record?.unresolvedPaths ?? [];
  const targetPaths =
    unresolvedPaths.length > 0
      ? unresolvedPaths
      : primaryPath
        ? [primaryPath]
        : [];
  const isWorkspace =
    targetPaths.length === 1 && targetPaths[0] === workspacePath;
  const targetPathString = targetPaths.join(", ");

  const canUseLocalScope = status.record?.canUseLocalScope !== false;
  const blockingPath = status.record?.blockingLocalPath;
  const isBlockingPathRepo = status.record?.isBlockingPathRepo ?? false;

  const [formName, setFormName] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formScope, setFormScope] = useState<GitIdentityScope>(() =>
    canUseLocalScope ? "local" : "global",
  );
  // The problems as of the last check point — the field was left, or Configure
  // was pressed (#268). Typing never re-checks: it clears the field's own
  // problem, so an error cannot interrupt a half-written name or address, and
  // it comes back when the user leaves the field again.
  const [errors, setErrors] = useState<{
    name: string | null;
    email: string | null;
  }>({ name: null, email: null });

  useEffect(() => {
    if (!canUseLocalScope) {
      setFormScope("global");
    }
  }, [canUseLocalScope]);

  const identity = status.record?.gitIdentity;
  const hasUnresolved = (status.record?.unresolvedRepoIds?.length ?? 0) > 0;

  const nameError = errors.name;
  const emailError = errors.email;

  const isFormValid =
    formName.trim().length > 0 &&
    !hasControlCharacters(formName) &&
    formEmail.trim().length > 0 &&
    isValidEmail(formEmail);

  const handleConfigureSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const problems = {
      name: nameProblem(formName),
      email: emailProblem(formEmail),
    };
    setErrors(problems);
    if (
      !isFormValid ||
      isConfiguring ||
      problems.name !== null ||
      problems.email !== null
    ) {
      return;
    }
    await configureIdentity({
      name: formName.trim(),
      email: formEmail.trim(),
      scope: formScope,
    });
  };

  const renderForm = () => (
    <form
      className="git-identity-form"
      onSubmit={handleConfigureSubmit}
      noValidate
    >
      <div className="git-identity-form-header">
        <h3 className="git-identity-form-title">
          {INSPECTION_COPY.configureTitle}
        </h3>
        <p className="git-identity-form-hint">
          {INSPECTION_COPY.configureHint}
        </p>
      </div>

      <div className="git-identity-fields">
        <div className="form-group">
          <label htmlFor="git-identity-name-input" className="form-label">
            {INSPECTION_COPY.authorNameLabel}
          </label>
          <input
            id="git-identity-name-input"
            type="text"
            className="form-input"
            placeholder={INSPECTION_COPY.authorNamePlaceholder}
            value={formName}
            onChange={(e) => {
              setFormName(e.target.value);
              setErrors((current) =>
                current.name === null ? current : { ...current, name: null },
              );
            }}
            onBlur={() =>
              setErrors((current) => ({
                ...current,
                name: nameProblem(formName),
              }))
            }
            disabled={isConfiguring}
            aria-invalid={nameError ? "true" : undefined}
            aria-describedby={nameError ? "git-identity-name-error" : undefined}
            required
          />
          {nameError && (
            <FieldFeedback
              id="git-identity-name-error"
              state="invalid"
              message={nameError}
            />
          )}
        </div>

        <div className="form-group">
          <label htmlFor="git-identity-email-input" className="form-label">
            {INSPECTION_COPY.authorEmailLabel}
          </label>
          <input
            id="git-identity-email-input"
            type="email"
            className="form-input code-font"
            placeholder={INSPECTION_COPY.authorEmailPlaceholder}
            value={formEmail}
            onChange={(e) => {
              setFormEmail(e.target.value);
              setErrors((current) =>
                current.email === null ? current : { ...current, email: null },
              );
            }}
            onBlur={() =>
              setErrors((current) => ({
                ...current,
                email: emailProblem(formEmail),
              }))
            }
            disabled={isConfiguring}
            aria-invalid={emailError ? "true" : undefined}
            aria-describedby={
              emailError ? "git-identity-email-error" : undefined
            }
            required
          />
          {emailError && (
            <FieldFeedback
              id="git-identity-email-error"
              state="invalid"
              message={emailError}
            />
          )}
        </div>
      </div>

      <div className="git-identity-scope-section">
        <span className="git-identity-scope-label">
          {INSPECTION_COPY.scopeLabel}
        </span>
        {/* The scope choice is one control with two mutually exclusive options,
            so it is the shared segmented control (#251): one tab stop, arrow
            keys between the segments, the chosen one announced as checked. */}
        <SegmentedControl
          label={INSPECTION_COPY.scopeLabel}
          value={formScope}
          onChange={(id) => setFormScope(id as GitIdentityScope)}
          className="git-identity-scope-options"
          options={[
            {
              id: "local",
              label:
                targetPaths.length > 1
                  ? INSPECTION_COPY.scopeRepositoriesOption(targetPaths)
                  : isWorkspace
                    ? INSPECTION_COPY.scopeWorkspaceOption(
                        targetPaths[0] ?? workspacePath,
                      )
                    : INSPECTION_COPY.scopeLocalOption(
                        targetPaths[0] ?? primaryPath,
                      ),
              isDisabled: isConfiguring || !canUseLocalScope,
            },
            {
              id: "global",
              label: INSPECTION_COPY.scopeGlobalOption,
              isDisabled: isConfiguring,
            },
          ]}
        />
        {!canUseLocalScope && (
          <p
            className="git-identity-scope-warning"
            id="git-identity-scope-not-repo"
          >
            {isBlockingPathRepo && blockingPath
              ? INSPECTION_COPY.blockingPathNotRepoRoot(blockingPath)
              : blockingPath && blockingPath !== (targetPaths[0] ?? primaryPath)
                ? INSPECTION_COPY.blockingPathNotRepo(blockingPath)
                : INSPECTION_COPY.notAGitRepository}
          </p>
        )}
        <p className="git-identity-scope-hint" id="git-identity-scope-hint">
          {INSPECTION_COPY.scopeHint(formScope, targetPathString)}
        </p>
      </div>

      {configureError !== null && (
        <FeedbackBanner
          tone="error"
          message={resolveConfigureErrorMessage(configureError)}
        />
      )}

      <div className="git-identity-form-actions">
        <Button
          type="submit"
          id="btn-configure-git-identity"
          variant="primary"
          isDisabled={!isFormValid || isConfiguring}
        >
          {isConfiguring
            ? INSPECTION_COPY.configuringButton
            : INSPECTION_COPY.configureButton}
        </Button>
      </div>
    </form>
  );

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
          {identity && (
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
          )}
          {!identity && status.record !== null && (
            <div
              id="inspection-identity-missing"
              className="inspection-missing-container"
            >
              <FeedbackBanner
                tone="warning"
                message={INSPECTION_COPY.identityMissing(inspectedPath)}
              />
              <div className="git-identity-explanation">
                <p className="git-identity-explanation-text">
                  {INSPECTION_COPY.identityExplanation}
                </p>
              </div>
              {renderForm()}
            </div>
          )}
          {identity && hasUnresolved && (
            <div
              id="inspection-identity-unresolved"
              className="inspection-missing-container"
            >
              <div className="git-identity-explanation">
                <p className="git-identity-explanation-text">
                  {INSPECTION_COPY.identityExplanation}
                </p>
              </div>
              {renderForm()}
            </div>
          )}
        </AsyncRegion>
      </div>

      <WizardFooter step={4} onBack={prevStep} onNext={nextStep} />
    </div>
  );
}
