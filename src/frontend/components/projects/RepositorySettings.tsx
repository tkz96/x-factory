// src/frontend/components/projects/RepositorySettings.tsx — Edit each
// repository's checkout folder and its test / typecheck / lint commands from
// the project detail (#283). Saves through the partial project update; the
// other repositories are sent back unchanged.

import "./RepositorySettings.css";

import { useState } from "react";
import type {
  ProjectRepository,
  RepositoryCommands,
} from "../../../shared/types.js";
import { useUpdateProjectRepositories } from "../../hooks/useQueries.js";
import { REPOSITORY_SETTINGS_COPY } from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

interface RepositorySettingsProps {
  projectId: string;
  repositories: readonly ProjectRepository[];
}

type CommandField = "test" | "typecheck" | "lint";
const COMMAND_FIELDS: readonly CommandField[] = ["test", "typecheck", "lint"];

/** The repository with its edited path and commands; blank commands are dropped. */
function applyEdit(
  repo: ProjectRepository,
  pathValue: string,
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
    ...(Object.keys(next).length > 0 ? { commands: next } : {}),
  };
}

function RepositoryForm({
  projectId,
  repo,
  repositories,
}: {
  projectId: string;
  repo: ProjectRepository;
  repositories: readonly ProjectRepository[];
}) {
  const mutation = useUpdateProjectRepositories(projectId);
  const [pathValue, setPathValue] = useState(repo.path);
  const [commands, setCommands] = useState<Record<CommandField, string>>({
    test: repo.commands?.test ?? "",
    typecheck: repo.commands?.typecheck ?? "",
    lint: repo.commands?.lint ?? "",
  });
  const [pathError, setPathError] = useState(false);
  const prefix = `repo-settings-${repo.id}`;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pathValue.trim()) {
      setPathError(true);
      return;
    }
    setPathError(false);
    mutation.mutate(
      repositories.map((r) =>
        r.id === repo.id ? applyEdit(r, pathValue, commands) : r,
      ),
    );
  };

  return (
    <Card className="repo-settings-item" padding="compact">
      <form className="repo-settings-form" onSubmit={save} noValidate>
        <h4 className="repo-settings-name text-headline">{repo.name}</h4>

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

        {COMMAND_FIELDS.map((field) => (
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
        ))}

        {pathError && (
          <FeedbackBanner
            tone="error"
            message={REPOSITORY_SETTINGS_COPY.pathRequired}
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
            type="submit"
            id={`${prefix}-save`}
            variant="primary"
            size="sm"
            isDisabled={mutation.isPending}
          >
            {mutation.isPending
              ? REPOSITORY_SETTINGS_COPY.saving
              : REPOSITORY_SETTINGS_COPY.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function RepositorySettings({
  projectId,
  repositories,
}: RepositorySettingsProps) {
  return (
    <section className="repo-settings" aria-labelledby="repo-settings-title">
      <h3 id="repo-settings-title" className="text-headline">{REPOSITORY_SETTINGS_COPY.title}</h3>
      {repositories.map((repo) => (
        <RepositoryForm
          key={repo.id}
          projectId={projectId}
          repo={repo}
          repositories={repositories}
        />
      ))}
    </section>
  );
}
