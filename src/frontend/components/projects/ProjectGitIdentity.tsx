// src/frontend/components/projects/ProjectGitIdentity.tsx — The project's git
// identity on the project detail: shown, editable, saved with the project.
// Every commit X-Factory makes for the project is authored with it; saving it
// writes no git config file. Both parts are required and the email needs "@".

import "./ProjectGitIdentity.css";

import { useState } from "react";
import type { GitIdentity } from "../../../shared/types.js";
import { useUpdateProjectGitIdentity } from "../../hooks/useQueries.js";
import { PROJECT_GIT_IDENTITY_COPY } from "../feedback/copy-map.js";
import { FeedbackBanner } from "../feedback/FeedbackBanner.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";

interface ProjectGitIdentityProps {
  projectId: string;
  gitIdentity?: GitIdentity | undefined;
}

/** What is wrong with the identity, or null when it can be saved. */
function problemWith(name: string, email: string): string | null {
  if (name.trim() === "") return PROJECT_GIT_IDENTITY_COPY.nameRequired;
  if (email.trim() === "") return PROJECT_GIT_IDENTITY_COPY.emailRequired;
  if (!email.includes("@")) return PROJECT_GIT_IDENTITY_COPY.emailInvalid;
  return null;
}

export function ProjectGitIdentity({
  projectId,
  gitIdentity,
}: ProjectGitIdentityProps) {
  const mutation = useUpdateProjectGitIdentity(projectId);
  const [name, setName] = useState(gitIdentity?.name ?? "");
  const [email, setEmail] = useState(gitIdentity?.email ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const found = problemWith(name, email);
    setProblem(found);
    if (found !== null) return;
    mutation.mutate({ name: name.trim(), email: email.trim() });
  };

  return (
    <Card padding="compact">
      <form
        className="project-git-identity-form"
        id="project-git-identity"
        onSubmit={save}
        noValidate
      >
        <h3 className="project-git-identity-title text-headline">
          {PROJECT_GIT_IDENTITY_COPY.title}
        </h3>
        <p className="project-git-identity-help text-subhead">
          {gitIdentity
            ? PROJECT_GIT_IDENTITY_COPY.help
            : PROJECT_GIT_IDENTITY_COPY.notSet}
        </p>
        <div className="project-git-identity-fields">
          <label
            className="project-git-identity-field"
            htmlFor="project-git-identity-name"
          >
            <span className="project-git-identity-label text-subhead">
              {PROJECT_GIT_IDENTITY_COPY.name}
            </span>
            <input
              id="project-git-identity-name"
              className="form-input text-callout"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label
            className="project-git-identity-field"
            htmlFor="project-git-identity-email"
          >
            <span className="project-git-identity-label text-subhead">
              {PROJECT_GIT_IDENTITY_COPY.email}
            </span>
            <input
              id="project-git-identity-email"
              type="email"
              className="form-input code-font text-callout"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
        </div>
        {problem !== null && <FeedbackBanner tone="error" message={problem} />}
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
        <div className="project-git-identity-actions">
          {mutation.isSuccess && (
            <span
              className="project-git-identity-saved text-subhead"
              role="status"
            >
              {PROJECT_GIT_IDENTITY_COPY.saved}
            </span>
          )}
          <Button
            type="submit"
            id="project-git-identity-save"
            variant="primary"
            size="sm"
            isDisabled={mutation.isPending}
          >
            {mutation.isPending
              ? PROJECT_GIT_IDENTITY_COPY.saving
              : PROJECT_GIT_IDENTITY_COPY.save}
          </Button>
        </div>
      </form>
    </Card>
  );
}
