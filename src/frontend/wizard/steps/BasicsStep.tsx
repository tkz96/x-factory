// src/frontend/wizard/steps/BasicsStep.tsx — Step 1: Project Name, ID, Description, Workspace Path (spec #126, #130, #142).

import "./BasicsStep.css";

import { useCallback, useState } from "react";
import { normalizeProjectId } from "../../../shared/project-identity.js";
import { useWizard } from "../state/wizardContext.js";

interface BasicsStepProps {
  onCancel?: () => void;
}

export function BasicsStep({ onCancel }: BasicsStepProps) {
  const { state, updateBasics, nextStep, canAdvance } = useWizard();
  const { name, id, description, workspacePath } = state.basics;

  const [idManuallyEdited, setIdManuallyEdited] = useState(() => {
    return Boolean(id && id !== normalizeProjectId(name));
  });
  const [touchedName, setTouchedName] = useState(false);
  const [touchedId, setTouchedId] = useState(false);

  const handleNameChange = useCallback(
    (newName: string) => {
      const patch: { name: string; id?: string } = { name: newName };
      if (!idManuallyEdited) {
        patch.id = normalizeProjectId(newName);
      }
      updateBasics(patch);
    },
    [idManuallyEdited, updateBasics],
  );

  const handleIdChange = useCallback(
    (newId: string) => {
      setIdManuallyEdited(true);
      updateBasics({ id: newId });
    },
    [updateBasics],
  );

  const handleDescriptionChange = useCallback(
    (newDesc: string) => {
      updateBasics({ description: newDesc });
    },
    [updateBasics],
  );

  const handleWorkspacePathChange = useCallback(
    (newPath: string) => {
      updateBasics({ workspacePath: newPath });
    },
    [updateBasics],
  );

  const nameError =
    touchedName && !name.trim() ? "Project display name is required." : null;
  const idError =
    touchedId && !id.trim() ? "Stable project identifier is required." : null;

  return (
    <div id="onboard-step-1" className="wizard-step-pane">
      <div className="wizard-step-header">
        <h2 className="wizard-step-title">Project Basics</h2>
        <p className="wizard-step-subtitle">
          Define the identity and local root directory for your project.
        </p>
      </div>

      <div className="wizard-form-group">
        <label htmlFor="onboard-proj-name" className="wizard-form-label">
          Project Display Name <span className="required">*</span>
        </label>
        <input
          id="onboard-proj-name"
          type="text"
          placeholder="e.g. Converso"
          className="form-input"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          onBlur={() => setTouchedName(true)}
          required
        />
        {nameError && (
          <span className="wizard-form-error" role="alert">
            {nameError}
          </span>
        )}
      </div>

      <div className="wizard-form-group">
        <label htmlFor="onboard-proj-id" className="wizard-form-label">
          Stable Project Identifier <span className="required">*</span>
        </label>
        <input
          id="onboard-proj-id"
          type="text"
          placeholder="e.g. converso"
          className="form-input code-input"
          value={id}
          onChange={(e) => handleIdChange(e.target.value)}
          onBlur={() => setTouchedId(true)}
          required
        />
        <span className="wizard-form-hint">
          Used in CLI commands, configuration paths, and branch naming.
        </span>
        {idError && (
          <span className="wizard-form-error" role="alert">
            {idError}
          </span>
        )}
      </div>

      <div className="wizard-form-group">
        <label htmlFor="onboard-proj-description" className="wizard-form-label">
          Project Description
        </label>
        <textarea
          id="onboard-proj-description"
          placeholder="Brief description of the repository or service"
          className="form-input"
          rows={2}
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
        />
      </div>

      <div className="wizard-form-group">
        <label htmlFor="onboard-workspace-path" className="wizard-form-label">
          Local Workspace Root Directory
        </label>
        <input
          id="onboard-workspace-path"
          type="text"
          placeholder="e.g. ~/projects or /path/to/workspace"
          className="form-input code-input"
          value={workspacePath}
          onChange={(e) => handleWorkspacePathChange(e.target.value)}
        />
        <span className="wizard-form-hint">
          Root folder where worktrees and clones will be initialized.
        </span>
      </div>

      <div className="wizard-actions">
        {onCancel && (
          <button
            type="button"
            id="btn-step-1-cancel"
            className="btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          id="btn-step-1-next"
          className="btn-primary"
          disabled={!canAdvance}
          onClick={nextStep}
        >
          Continue to Connect →
        </button>
      </div>
    </div>
  );
}
