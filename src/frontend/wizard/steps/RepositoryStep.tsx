// src/frontend/wizard/steps/RepositoryStep.tsx — Step 1: paste a repository
// URL (#268, spec #241 stories 112 and 115).
//
// The easiest step comes first: one URL, and the project's identity derived
// around it. Two rules shape the step:
//
//   * fields are checked when the user LEAVES them and when they press
//     Continue — never while they type, so an error never interrupts a
//     half-written URL or name;
//   * a URL no provider recognises is not an error. The providers are asked
//     (`api.providers.parseUrl`) so a match can pre-fill the Connect step, but
//     the URL itself, and the project's name, are the user's to decide.
//
// The fields are the #251 control blocks; the URL field's feedback is the
// feedback family's `FieldFeedback`.

import "./RepositoryStep.css";

import type { ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import { normalizeProjectId } from "../../../shared/project-identity.js";
import { REPOSITORY_STEP_COPY } from "../../components/feedback/copy-map.js";
import { FieldFeedback } from "../../components/feedback/FieldFeedback.js";
import { TextAreaField, TextField } from "../../components/ui/TextField.js";
import { WizardFooter } from "../shared/WizardFooter.js";
import { repositoryUrlError } from "../state/repositoryUrl.js";
import { useWizardUrlIntake } from "../state/urlIntake.js";
import { useWizard } from "../state/wizardContext.js";

interface Touched {
  url: boolean;
  name: boolean;
  id: boolean;
}

const UNTOUCHED: Touched = { url: false, name: false, id: false };

/**
 * The URL field's feedback: what the USER's text is wrong about first (the
 * error), then what the providers found (an informational miss, never a
 * block), and nothing at all while the value looks fine.
 */
function urlFeedback(
  error: string | null,
  missMessage: string | null,
): ReactNode {
  if (error !== null) {
    return (
      <FieldFeedback
        state="invalid"
        message={error}
        id="onboard-repo-url-feedback"
      />
    );
  }
  if (missMessage !== null) {
    return (
      <FieldFeedback
        state="warning"
        message={missMessage}
        id="quick-url-miss-feedback"
      />
    );
  }
  return undefined;
}

export function RepositoryStep() {
  const { state, dispatch, nextStep, updateBasics } = useWizard();
  const { name, id, description, workspacePath } = state.basics;
  const urlIntake = useWizardUrlIntake();

  const [idManuallyEdited, setIdManuallyEdited] = useState(() =>
    Boolean(id && id !== normalizeProjectId(name)),
  );
  const [touched, setTouched] = useState<Touched>(UNTOUCHED);
  // True once Continue was pressed: from then on every field reports its state,
  // whether or not the user has left it yet.
  const [attempted, setAttempted] = useState(false);
  const parsedUrlRef = useRef<string | null>(null);

  // The URL lives in wizard state, so it survives a step change even when no
  // provider claims it.
  const url = state.connect.quickUrl;

  const handleUrlChange = useCallback(
    (next: string) => {
      dispatch({ type: "SET_REPOSITORY_URL", url: next });
    },
    [dispatch],
  );

  const handleNameChange = useCallback(
    (next: string) => {
      const patch: { name: string; id?: string } = { name: next };
      if (!idManuallyEdited) {
        patch.id = normalizeProjectId(next);
      }
      updateBasics(patch);
    },
    [idManuallyEdited, updateBasics],
  );

  const handleIdChange = useCallback(
    (next: string) => {
      setIdManuallyEdited(true);
      updateBasics({ id: next });
    },
    [updateBasics],
  );

  /**
   * Asks the providers about the pasted URL — once per URL, on leaving the
   * field and on Continue. A match pre-fills the Connect step; a miss is an
   * informational message, never a block. The ask is fire-and-forget so Continue
   * never waits on a network read to move on; the answer is applied by the
   * sheet, which outlives this step (see `state/urlIntake.tsx`).
   */
  const askAboutUrl = useCallback(
    (candidate: string) => {
      const trimmed = candidate.trim();
      if (trimmed === "" || parsedUrlRef.current === trimmed) return;
      parsedUrlRef.current = trimmed;
      urlIntake.ask(trimmed);
    },
    [urlIntake],
  );

  const handleUrlBlur = useCallback(() => {
    setTouched((current) => ({ ...current, url: true }));
    if (repositoryUrlError(url) === null) {
      askAboutUrl(url);
    }
  }, [url, askAboutUrl]);

  const handleContinue = useCallback(() => {
    setAttempted(true);
    const urlProblem = repositoryUrlError(url);
    const nameProblem =
      name.trim() === "" ? REPOSITORY_STEP_COPY.nameRequired : null;
    const idProblem =
      id.trim() === "" ? REPOSITORY_STEP_COPY.identifierRequired : null;
    if (urlProblem !== null || nameProblem !== null || idProblem !== null) {
      return;
    }
    askAboutUrl(url);
    nextStep();
  }, [url, name, id, askAboutUrl, nextStep]);

  const urlError = touched.url || attempted ? repositoryUrlError(url) : null;
  const nameError =
    (touched.name || attempted) && name.trim() === ""
      ? REPOSITORY_STEP_COPY.nameRequired
      : null;
  const idError =
    (touched.id || attempted) && id.trim() === ""
      ? REPOSITORY_STEP_COPY.identifierRequired
      : null;

  return (
    <div id="onboard-step-1" className="wizard-step-pane repository-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">{REPOSITORY_STEP_COPY.title}</h2>
        <p className="wizard-step-subtitle">{REPOSITORY_STEP_COPY.subtitle}</p>
      </div>

      <TextField
        label={REPOSITORY_STEP_COPY.urlLabel}
        description={REPOSITORY_STEP_COPY.urlDescription}
        inputId="onboard-repo-url"
        inputType="url"
        placeholder="https://github.com/owner/repository"
        value={url}
        onChange={handleUrlChange}
        onBlur={handleUrlBlur}
        isInvalid={urlError !== null}
        isRequired
        feedback={urlFeedback(urlError, urlIntake.missMessage)}
      />

      <h3 className="repository-step-section">
        {REPOSITORY_STEP_COPY.detailsTitle}
      </h3>

      <TextField
        label={REPOSITORY_STEP_COPY.nameLabel}
        inputId="onboard-proj-name"
        value={name}
        onChange={handleNameChange}
        onBlur={() => setTouched((current) => ({ ...current, name: true }))}
        isInvalid={nameError !== null}
        isRequired
        feedback={
          nameError !== null ? (
            <FieldFeedback state="invalid" message={nameError} />
          ) : undefined
        }
      />

      <TextField
        label={REPOSITORY_STEP_COPY.identifierLabel}
        description={REPOSITORY_STEP_COPY.identifierHint}
        inputId="onboard-proj-id"
        className="repository-step-identifier"
        value={id}
        onChange={handleIdChange}
        onBlur={() => setTouched((current) => ({ ...current, id: true }))}
        isInvalid={idError !== null}
        isRequired
        feedback={
          idError !== null ? (
            <FieldFeedback state="invalid" message={idError} />
          ) : undefined
        }
      />

      <TextAreaField
        label={REPOSITORY_STEP_COPY.descriptionLabel}
        inputId="onboard-proj-description"
        value={description}
        onChange={(next) => updateBasics({ description: next })}
      />

      <TextField
        label={REPOSITORY_STEP_COPY.workspaceLabel}
        description={REPOSITORY_STEP_COPY.workspaceHint}
        inputId="onboard-workspace-path"
        placeholder="~/projects"
        value={workspacePath}
        onChange={(next) => updateBasics({ workspacePath: next })}
      />

      <WizardFooter step={1} onNext={handleContinue} />
    </div>
  );
}
