// src/frontend/components/projects/RepositorySettings.tsx — The form for ONE
// repository: its base branch, test / typecheck / lint commands and checkout
// folder (#283). The Repositories tab shows the form of the selected
// repository. Saves through the partial project update; the other repositories
// are sent back unchanged.

import "./RepositorySettings.css";

import { useState } from "react";
import type {
  ProjectRepository,
  RepositoryCommands,
} from "../../../shared/types.js";
import { useUpdateProjectRepositories } from "../../hooks/useQueries.js";
import { api } from "../../lib/api-client.js";
import { REPOSITORY_SETTINGS_COPY } from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import { Badge } from "../ui/Badge.js";
import { Button } from "../ui/Button.js";
import { BaseBranchPicker } from "./BaseBranchPicker.js";

interface RepositorySettingsProps {
  projectId: string;
  /** The repository this form edits. */
  repository: ProjectRepository;
  /** Every repository of the project: a save sends them all back. */
  repositories: readonly ProjectRepository[];
  /** The project's primary repository gets a badge. */
  isPrimary?: boolean;
}

type CommandField = "test" | "typecheck" | "lint";
const COMMAND_FIELDS: readonly CommandField[] = ["test", "typecheck", "lint"];

/** The repository with its edited path and commands; blank commands are dropped. */
function applyEdit(
  repo: ProjectRepository,
  pathValue: string,
  baseBranch: string,
  commands: Record<CommandField, string>,
): ProjectRepository {
  const next: RepositoryCommands = { ...repo.commands };
  for (const field of COMMAND_FIELDS) {
    const value = commands[field].trim();
    if (value) next[field] = value;
    else delete next[field];
  }
  const { commands: _previous, ...rest } = repo;
  return {
    ...rest,
    path: pathValue.trim(),
    defaultBranch: baseBranch.trim(),
    ...(Object.keys(next).length > 0 ? { commands: next } : {}),
  };
}

export function RepositorySettings({
  projectId,
  repository: repo,
  repositories,
  isPrimary = false,
}: RepositorySettingsProps) {
  const mutation = useUpdateProjectRepositories(projectId);
  const initialCommands: Record<CommandField, string> = {
    test: repo.commands?.test ?? "",
    typecheck: repo.commands?.typecheck ?? "",
    lint: repo.commands?.lint ?? "",
  };
  const [pathValue, setPathValue] = useState(repo.path);
  const [baseBranch, setBaseBranch] = useState(repo.defaultBranch);
  const [branchError, setBranchError] = useState(false);
  const [commands, setCommands] = useState(initialCommands);
  const [pathError, setPathError] = useState(false);
  const prefix = `repo-settings-${repo.id}`;

  const dirty =
    pathValue !== repo.path ||
    baseBranch !== repo.defaultBranch ||
    COMMAND_FIELDS.some((field) => commands[field] !== initialCommands[field]);

  const revert = () => {
    setPathValue(repo.path);
    setBaseBranch(repo.defaultBranch);
    setCommands(initialCommands);
    setPathError(false);
    setBranchError(false);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirty) return;
    if (!pathValue.trim()) {
      setPathError(true);
      return;
    }
    setPathError(false);
    if (!baseBranch.trim()) {
      setBranchError(true);
      return;
    }
    setBranchError(false);
    mutation.mutate(
      repositories.map((r) =>
        r.id === repo.id ? applyEdit(r, pathValue, baseBranch, commands) : r,
      ),
      {
        // The server keeps the trimmed values: show them, so the form is
        // clean again once the project reloads.
        onSuccess: () => {
          setPathValue(pathValue.trim());
          setBaseBranch(baseBranch.trim());
          setCommands({
            test: commands.test.trim(),
            typecheck: commands.typecheck.trim(),
            lint: commands.lint.trim(),
          });
        },
      },
    );
  };

  const commandField = (field: CommandField) => (
    <label
      key={field}
      className="repo-settings-field"
      htmlFor={`${prefix}-${field}`}
    >
      <span className="repo-settings-label text-subhead">
        {REPOSITORY_SETTINGS_COPY[field]}
      </span>
      <input
        id={`${prefix}-${field}`}
        className="form-input repo-settings-input repo-settings-input--mono text-callout"
        value={commands[field]}
        placeholder={
          field === "test" ? undefined : REPOSITORY_SETTINGS_COPY.optional
        }
        onChange={(e) =>
          setCommands((prev) => ({ ...prev, [field]: e.target.value }))
        }
      />
      {field === "test" && (
        <span className="repo-settings-help text-subhead">
          {REPOSITORY_SETTINGS_COPY.testHelp}
        </span>
      )}
    </label>
  );

  return (
    <form
      className="repo-settings-form"
      aria-label={repo.name}
      onSubmit={save}
      noValidate
    >
      <div className="repo-settings-heading">
        <h4 className="repo-settings-name text-title-3">{repo.name}</h4>
        {isPrimary && (
          <Badge tone="accent">{REPOSITORY_SETTINGS_COPY.primary}</Badge>
        )}
      </div>

      <div className="repo-settings-field">
        <BaseBranchPicker
          repositoryId={repo.id}
          branch={baseBranch}
          onChange={setBaseBranch}
          queryKey={["projects", "branches", projectId, repo.id]}
          loadBranches={() => api.getRepositoryBranches(projectId, repo.id)}
        />
        <span className="repo-settings-help text-subhead">
          {REPOSITORY_SETTINGS_COPY.baseBranchHelp}
        </span>
      </div>

      {commandField("test")}
      <div className="repo-settings-pair">
        {commandField("typecheck")}
        {commandField("lint")}
      </div>

      <label className="repo-settings-field" htmlFor={`${prefix}-path`}>
        <span className="repo-settings-label text-subhead">
          {REPOSITORY_SETTINGS_COPY.path}
        </span>
        <input
          id={`${prefix}-path`}
          className="form-input repo-settings-input text-callout"
          value={pathValue}
          aria-invalid={pathError}
          aria-describedby={`${prefix}-path-help`}
          onChange={(e) => setPathValue(e.target.value)}
        />
        <span
          id={`${prefix}-path-help`}
          className="repo-settings-help text-subhead"
        >
          {REPOSITORY_SETTINGS_COPY.pathHelp}
        </span>
      </label>

      {pathError && (
        <FeedbackBanner
          tone="error"
          message={REPOSITORY_SETTINGS_COPY.pathRequired}
        />
      )}
      {branchError && (
        <FeedbackBanner
          tone="error"
          message={REPOSITORY_SETTINGS_COPY.baseBranchRequired}
        />
      )}
      {mutation.isError && (
        <FeedbackBanner
          tone="error"
          message={
            mutation.error instanceof Error
              ? mutation.error.message
              : String(mutation.error)
          }
        />
      )}

      <div className="repo-settings-actions">
        {mutation.isSuccess && (
          <span className="repo-settings-saved text-subhead" role="status">
            {REPOSITORY_SETTINGS_COPY.saved}
          </span>
        )}
        <Button
          id={`${prefix}-revert`}
          variant="secondary"
          size="sm"
          isDisabled={!dirty || mutation.isPending}
          onPress={revert}
        >
          {REPOSITORY_SETTINGS_COPY.revert}
        </Button>
        <Button
          type="submit"
          id={`${prefix}-save`}
          variant="primary"
          size="sm"
          isDisabled={!dirty || mutation.isPending}
        >
          {mutation.isPending
            ? REPOSITORY_SETTINGS_COPY.saving
            : REPOSITORY_SETTINGS_COPY.save}
        </Button>
      </div>
    </form>
  );
}
